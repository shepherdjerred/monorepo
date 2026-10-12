import {
  type AccountRegionalRoute,
  PlatformRouteSchema,
  platformToAccountRegionalRoute,
} from "@scout-for-lol/data";
import {
  type LeaguePuuid,
  LeaguePuuidSchema,
} from "@scout-for-lol/domain/identity/league-account.ts";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { riotClient } from "#src/league/api/api.ts";
import { extractHttpStatus } from "#src/league/api/client/errors.ts";
import { createLogger } from "#src/logger.ts";
import { scoutClientIdentityAliasesTotal } from "#src/metrics/scout-client.ts";
import { withTimeout } from "#src/utils/timeout.ts";

const logger = createLogger("scout-client-identity");

/**
 * The League client's bot identity: every bot slot carries this UUID, with
 * account and summoner ID 0. It names no account, so it is never aliased.
 */
export const LCU_BOT_UUID = "00000000-0000-0000-0000-000000000000";

const LcuUuidSchema = z.uuid();

/** Keys under which LCU payloads carry a player's UUID. */
const IDENTITY_KEYS = new Set(["puuid", "summonerPuuid", "PUUID"]);

/** League-client UUID to Riot API PUUID. */
export type IdentityMap = ReadonlyMap<string, string>;

/** A player as the League client reports them: UUID plus Riot ID. */
export type LcuIdentity = {
  readonly lcuUuid: string;
  readonly gameName: string;
  readonly tagLine: string;
};

/** Whether `value` is a League-client player UUID that names a real account. */
export function isLcuUuid(value: string): boolean {
  return value !== LCU_BOT_UUID && LcuUuidSchema.safeParse(value).success;
}

const IdentityRecordSchema = z.object({
  puuid: z.string(),
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
});

function visit(value: unknown, onObject: (object: object) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, onObject);
    return;
  }
  if (value === null || typeof value !== "object") return;
  onObject(value);
  for (const item of Object.values(value)) visit(item, onObject);
}

/**
 * Every player identity a payload states in full.
 *
 * Only an object carrying a UUID together with both halves of a Riot ID
 * counts: the current-summoner profile and match-history participant
 * identities do; lobby members and in-game rosters carry no tag line and so
 * cannot be resolved from their own payload.
 */
export function lcuIdentitiesIn(payload: unknown): readonly LcuIdentity[] {
  const found = new Map<string, LcuIdentity>();
  visit(payload, (object) => {
    const record = IdentityRecordSchema.safeParse(object);
    if (!record.success || !isLcuUuid(record.data.puuid)) return;
    found.set(record.data.puuid, {
      lcuUuid: record.data.puuid,
      gameName: record.data.gameName,
      tagLine: record.data.tagLine,
    });
  });
  return [...found.values()];
}

/** Every League-client UUID a payload mentions under an identity key. */
export function lcuUuidsIn(payload: unknown): ReadonlySet<string> {
  const found = new Set<string>();
  visit(payload, (object) => {
    for (const [key, value] of Object.entries(object)) {
      if (
        typeof value === "string" &&
        IDENTITY_KEYS.has(key) &&
        isLcuUuid(value)
      ) {
        found.add(value);
      }
    }
  });
  return found;
}

/**
 * The payload with every aliased League-client UUID replaced by its PUUID.
 *
 * The stored payload is never rewritten — raw client data is the evidence —
 * so every reader that interprets player identities translates its own copy.
 * A UUID with no alias is left as it is, which no Riot PUUID can equal, so an
 * unresolved player simply fails to join rather than joining wrongly.
 */
export function translatePayloadIdentities(
  payload: unknown,
  identities: IdentityMap,
): unknown {
  if (identities.size === 0) return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => translatePayloadIdentities(item, identities));
  }
  if (payload === null || typeof payload !== "object") return payload;
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === "string" && IDENTITY_KEYS.has(key)
        ? (identities.get(value) ?? value)
        : translatePayloadIdentities(value, identities),
    ]),
  );
}

/** The stored aliases for `lcuUuids`. */
export async function readIdentityAliases(
  lcuUuids: Iterable<string>,
): Promise<IdentityMap> {
  const wanted = [...new Set(lcuUuids)].filter((uuid) => isLcuUuid(uuid));
  if (wanted.length === 0) return new Map();
  const rows = await prisma.leagueIdentityAlias.findMany({
    where: { lcuUuid: { in: wanted } },
    select: { lcuUuid: true, puuid: true },
  });
  return new Map(rows.map((row) => [row.lcuUuid, row.puuid]));
}

/** Every League-client UUID known to name `puuid`. */
export async function lcuUuidsFor(
  puuid: LeaguePuuid,
): Promise<readonly string[]> {
  const rows = await prisma.leagueIdentityAlias.findMany({
    where: { puuid },
    select: { lcuUuid: true },
  });
  return rows.map((row) => row.lcuUuid);
}

/** A stored payload translated with whatever aliases already exist for it. */
export async function withRiotIdentities(payload: unknown): Promise<unknown> {
  return translatePayloadIdentities(
    payload,
    await readIdentityAliases(lcuUuidsIn(payload)),
  );
}

/** The account-v1 route for a platform the client reported, if it named one. */
export function accountRouteFor(
  platformId: string | undefined | null,
): AccountRegionalRoute {
  const platform = PlatformRouteSchema.safeParse(platformId?.toUpperCase());
  // Account-v1 answers for any account on any cluster; the platform only picks
  // the nearest one, so an unknown platform falls back rather than failing.
  return platform.success
    ? platformToAccountRegionalRoute(platform.data)
    : "AMERICAS";
}

export type LearnOptions = {
  readonly route: AccountRegionalRoute;
  readonly learnedFromDeviceId: string;
  /** The reporting device owner's PUUIDs; an alias resolving to one is verified. */
  readonly ownedPuuids: ReadonlySet<string>;
  /**
   * UUIDs the reporting device observes as. An unverified alias for one of
   * these is looked up again, because this device may be the player's own and
   * can vouch for it; anyone else's unverified alias is left alone, or every
   * batch would re-query every opponent.
   */
  readonly observerUuids: ReadonlySet<string>;
};

async function lookUp(
  identity: LcuIdentity,
  route: AccountRegionalRoute,
): Promise<LeaguePuuid | null> {
  try {
    const account = await withTimeout(
      riotClient.account.getByRiotId(
        identity.gameName,
        identity.tagLine,
        route,
      ),
    );
    return LeaguePuuidSchema.parse(account.puuid);
  } catch (error) {
    if (extractHttpStatus(error) === 404) {
      scoutClientIdentityAliasesTotal.inc({ outcome: "not_found" });
      return null;
    }
    // Not fatal to the observation that carried it: the next one naming this
    // player retries, and until then the player just doesn't join.
    scoutClientIdentityAliasesTotal.inc({ outcome: "error" });
    logger.warn("League-client identity lookup failed", error);
    return null;
  }
}

async function storeAlias(
  identity: LcuIdentity,
  puuid: LeaguePuuid,
  options: LearnOptions,
): Promise<void> {
  const verified = options.ownedPuuids.has(puuid);
  const fields = {
    puuid,
    gameName: identity.gameName,
    tagLine: identity.tagLine,
    source: "riot_id",
    ownerVerified: verified,
    learnedFromDeviceId: options.learnedFromDeviceId,
  };
  const existing = await prisma.leagueIdentityAlias.findUnique({
    where: { lcuUuid: identity.lcuUuid },
    select: { puuid: true, ownerVerified: true },
  });
  if (existing === null) {
    const created = await prisma.leagueIdentityAlias.createMany({
      data: [{ lcuUuid: identity.lcuUuid, ...fields }],
      skipDuplicates: true,
    });
    // Another batch got there first; settle against what it wrote.
    if (created.count === 0) return storeAlias(identity, puuid, options);
    scoutClientIdentityAliasesTotal.inc({ outcome: "learned" });
    return;
  }
  if (existing.puuid === puuid) {
    if (verified && !existing.ownerVerified) {
      await prisma.leagueIdentityAlias.update({
        where: { lcuUuid: identity.lcuUuid },
        data: { ownerVerified: true },
      });
    }
    return;
  }
  if (verified && !existing.ownerVerified) {
    await prisma.leagueIdentityAlias.update({
      where: { lcuUuid: identity.lcuUuid },
      data: { ...fields, resolvedAt: new Date() },
    });
    scoutClientIdentityAliasesTotal.inc({ outcome: "corrected" });
    return;
  }
  scoutClientIdentityAliasesTotal.inc({ outcome: "conflict" });
}

/**
 * Resolve and store aliases for identities that have none yet, and verify the
 * reporting device's own.
 *
 * Settled UUIDs cost nothing, so this is cheap to call on every batch: a player
 * is looked up the first time any paired client reports them, and once more if
 * their own client later vouches for an alias someone else's taught.
 */
export async function learnIdentityAliases(
  identities: readonly LcuIdentity[],
  options: LearnOptions,
): Promise<void> {
  if (identities.length === 0) return;
  const rows = await prisma.leagueIdentityAlias.findMany({
    where: {
      lcuUuid: { in: identities.map((identity) => identity.lcuUuid) },
    },
    select: {
      lcuUuid: true,
      ownerVerified: true,
      gameName: true,
      tagLine: true,
    },
  });
  const stored = new Map(rows.map((row) => [row.lcuUuid, row]));
  const settled = (identity: LcuIdentity): boolean => {
    const row = stored.get(identity.lcuUuid);
    if (row === undefined) return false;
    // Asking Riot about the same Riot ID again returns the same PUUID, so an
    // unverified observer alias is only worth re-checking when the client now
    // reports a different Riot ID for it — the forged-claim case. Otherwise a
    // device whose owner never registered the account would query Riot on
    // every batch.
    const sameRiotId =
      row.gameName.toLowerCase() === identity.gameName.toLowerCase() &&
      row.tagLine.toLowerCase() === identity.tagLine.toLowerCase();
    return (
      row.ownerVerified ||
      !options.observerUuids.has(identity.lcuUuid) ||
      sameRiotId
    );
  };
  for (const identity of identities) {
    if (settled(identity)) continue;
    const puuid = await lookUp(identity, options.route);
    if (puuid !== null) await storeAlias(identity, puuid, options);
  }
}
