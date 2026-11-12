import { z } from "zod";
import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { ArtifactKind } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import type { Db } from "#src/database/index.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import {
  lakeStagingReceiptKind,
  rawArchiveReceiptKind,
  storedRawArchiveDescriptor,
} from "#src/report-lake/durable-receipts.ts";

/**
 * Remediation for data a Scout desktop client uploaded.
 *
 * Every upload is attributable: a signed-in user approved the pairing that
 * issued the device token, every observation names its device, and a stored
 * match names its source observation. This module turns that attribution into
 * a plan (read-only) and an executor (idempotent, rerunnable) so an operator
 * can undo what one owner's or one device's uploads left behind.
 */

export type RemediationScope =
  | { readonly kind: "owner"; readonly ownerId: DiscordAccountId }
  | { readonly kind: "device"; readonly deviceId: string };

export type RemediationAction =
  /** Riot has the match: replace the client-derived artifacts with Riot's. */
  | "rederive"
  /** Riot does not have it: remove the client-derived artifacts. */
  | "delete"
  /** Nothing client-derived was stored; only raw observations remain. */
  | "observations-only";

export type RemediationMatch = {
  readonly matchId: RiotMatchId;
  readonly action: RemediationAction;
  readonly observationIds: readonly string[];
  /** The match's canonical selection row points at this scope's upload. */
  readonly clientSelected: boolean;
  /** Archive receipts that exist for the match today. */
  readonly archived: {
    readonly match: boolean;
    readonly timeline: boolean;
    readonly clientBundle: boolean;
  };
  /** Accepted post-game uploads for the same game from other devices. */
  readonly otherSuppliers: number;
};

export type RemediationDevice = {
  readonly id: string;
  readonly ownerId: string;
  readonly deviceName: string;
  readonly deviceState: string;
};

export type RemediationPlan = {
  readonly scope: RemediationScope;
  readonly devices: readonly RemediationDevice[];
  /** Devices that are still ACTIVE and will be revoked. */
  readonly revokeDeviceIds: readonly string[];
  readonly matches: readonly RemediationMatch[];
  /** Prematch (gameflow) observation ids. */
  readonly prematchObservationIds: readonly string[];
  /** Every raw observation that will be deleted, by kind. */
  readonly observationCounts: Readonly<Record<string, number>>;
  readonly observationTotal: number;
  /** Identity aliases learned from these devices. */
  readonly aliasCount: number;
};

export type RiotMatchOracle = {
  /** Whether Riot returns the match. Unexpected failures must throw. */
  readonly hasMatch: (matchId: RiotMatchId) => Promise<boolean>;
};

const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "match",
  "timeline",
  "client_bundle",
];

async function scopedDevices(
  db: Db,
  scope: RemediationScope,
): Promise<RemediationDevice[]> {
  const rows = await db.scoutClientDevice.findMany({
    where:
      scope.kind === "owner"
        ? { ownerId: scope.ownerId }
        : { id: scope.deviceId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    deviceName: row.deviceName,
    deviceState: row.deviceState,
  }));
}

function matchIdOf(row: {
  gameId: string | null;
  platformId: string | null;
}): RiotMatchId | null {
  if (row.gameId === null || row.platformId === null) return null;
  const parsed = RiotMatchIdSchema.safeParse(
    `${row.platformId.toUpperCase()}_${row.gameId}`,
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Read everything the scope supplied and decide what happens to it. Writes
 * nothing; the only outside call is `oracle.hasMatch`, for matches whose
 * stored artifacts came from the client.
 */
export async function buildRemediationPlan(
  db: Db,
  scope: RemediationScope,
  oracle: RiotMatchOracle,
): Promise<RemediationPlan> {
  const devices = await scopedDevices(db, scope);
  const deviceIds = devices.map((device) => device.id);
  const observations = await db.scoutClientObservation.findMany({
    where: { deviceId: { in: deviceIds } },
    select: {
      observationId: true,
      kind: true,
      gameId: true,
      platformId: true,
      disposition: true,
    },
    orderBy: { observationId: "asc" },
  });

  const observationCounts: Record<string, number> = {};
  for (const row of observations) {
    observationCounts[row.kind] = (observationCounts[row.kind] ?? 0) + 1;
  }

  const byMatch = new Map<RiotMatchId, string[]>();
  for (const row of observations) {
    if (row.kind !== "post_game") continue;
    const matchId = matchIdOf(row);
    if (matchId === null) continue;
    byMatch.set(matchId, [...(byMatch.get(matchId) ?? []), row.observationId]);
  }

  const matches: RemediationMatch[] = [];
  for (const [matchId, observationIds] of byMatch) {
    const canonical = await db.scoutClientCanonicalMatch.findUnique({
      where: { riotMatchId: matchId },
      select: { sourceObservationId: true },
    });
    const clientSelected =
      canonical !== null &&
      observations.some(
        (row) => row.observationId === canonical.sourceObservationId,
      );
    const archived = {
      match: await hasReceipt(db, matchId, "match"),
      timeline: await hasReceipt(db, matchId, "timeline"),
      clientBundle: await hasReceipt(db, matchId, "client_bundle"),
    };
    const clientDerived = clientSelected || archived.clientBundle;
    const action = await actionFor(clientDerived, matchId, oracle);
    const gameId = matchId.slice(matchId.indexOf("_") + 1);
    const platform = platformRouteOf(matchId);
    const otherSuppliers = await db.scoutClientObservation.count({
      where: {
        kind: "post_game",
        disposition: "ACCEPTED",
        gameId,
        platformId: { equals: platform, mode: "insensitive" },
        deviceId: { notIn: deviceIds },
      },
    });
    matches.push({
      matchId,
      action,
      observationIds,
      clientSelected,
      archived,
      otherSuppliers,
    });
  }

  return {
    scope,
    devices,
    revokeDeviceIds: devices
      .filter((device) => device.deviceState === "ACTIVE")
      .map((device) => device.id),
    matches,
    prematchObservationIds: observations
      .filter((row) => row.kind === "gameflow")
      .map((row) => row.observationId),
    observationCounts,
    observationTotal: observations.length,
    aliasCount: await db.leagueIdentityAlias.count({
      where: { learnedFromDeviceId: { in: deviceIds } },
    }),
  };
}

async function actionFor(
  clientDerived: boolean,
  matchId: RiotMatchId,
  oracle: RiotMatchOracle,
): Promise<RemediationAction> {
  if (!clientDerived) return "observations-only";
  return (await oracle.hasMatch(matchId)) ? "rederive" : "delete";
}

async function hasReceipt(
  db: Db,
  matchId: RiotMatchId,
  kind: ArtifactKind,
): Promise<boolean> {
  return (
    (await db.matchProcessingReceipt.count({
      where: { riotMatchId: matchId, kind: rawArchiveReceiptKind(kind) },
    })) > 0
  );
}

/** A plan with nothing left to do: a rerun after a complete apply. */
export function isPlanEmpty(plan: RemediationPlan): boolean {
  return (
    plan.revokeDeviceIds.length === 0 &&
    plan.matches.every((match) => match.action === "observations-only") &&
    plan.observationTotal === 0 &&
    plan.aliasCount === 0
  );
}

/** The plan as operator-readable lines. Carries ids only, never payloads. */
export function formatRemediationPlan(plan: RemediationPlan): string[] {
  const lines: string[] = [];
  const scope =
    plan.scope.kind === "owner"
      ? `owner ${plan.scope.ownerId}`
      : `device ${plan.scope.deviceId}`;
  lines.push(`Scope: ${scope}`);
  lines.push(`Devices: ${plan.devices.length.toString()}`);
  for (const device of plan.devices) {
    lines.push(
      `  device ${device.id} owner ${device.ownerId} (${device.deviceName}) ${device.deviceState}`,
    );
  }
  lines.push(
    `1. Revoke ${plan.revokeDeviceIds.length.toString()} active device(s)`,
  );
  const timelines = plan.matches.filter(
    (match) => match.action !== "observations-only" && match.archived.timeline,
  ).length;
  lines.push(
    `Supplied: ${plan.matches.length.toString()} match(es), ${timelines.toString()} client-derived timeline(s), ${plan.prematchObservationIds.length.toString()} prematch observation(s)`,
  );
  lines.push("2. Matches");
  for (const match of plan.matches) {
    const others =
      match.otherSuppliers > 0
        ? ` (${match.otherSuppliers.toString()} other device upload(s) exist)`
        : "";
    lines.push(
      `  ${match.matchId} ${match.action}${others} observations: ${match.observationIds.join(", ")}`,
    );
  }
  lines.push(
    `3. Delete ${plan.observationTotal.toString()} raw observation(s) ${JSON.stringify(plan.observationCounts)} and ${plan.aliasCount.toString()} learned alias(es)`,
  );
  lines.push(
    "4. Rebuild the report lake, then refresh Hall of Fame and competitions",
  );
  return lines;
}

export type RemediationDeps = {
  readonly riot: {
    readonly fetchMatch: (
      matchId: RiotMatchId,
    ) => Promise<RawMatch | undefined>;
    readonly fetchTimeline: (
      matchId: RiotMatchId,
    ) => Promise<RawTimeline | undefined>;
  };
  /** Deleting a key that does not exist must succeed. */
  readonly objects: { readonly delete: (key: string) => Promise<void> };
  readonly ingestMatch: (
    match: RawMatch,
    trackedPlayerAliases: string[],
  ) => Promise<void>;
  readonly ingestTimeline: (
    timeline: RawTimeline,
    trackedPlayerAliases: string[],
    gameCreatedAt: Date,
  ) => Promise<void>;
  /** The existing device revoke path. */
  readonly revokeDevice: (
    deviceId: string,
    ownerId: string,
  ) => Promise<boolean>;
  readonly refresh: {
    readonly rebuildLake: () => Promise<void>;
    readonly refreshHallOfFame: () => Promise<void>;
    readonly refreshCompetitions: () => Promise<void>;
  };
  readonly log?: (line: string) => void;
};

async function trackedAliasesFor(db: Db, match: RawMatch): Promise<string[]> {
  const accounts = await db.account.findMany({
    where: { puuid: { in: match.metadata.participants } },
    select: { alias: true },
  });
  return [...new Set(accounts.map((account) => account.alias))];
}

/**
 * Remove a match's client-derived archive: the objects first, then the
 * receipts that name them. A crash between the two leaves a receipt for a
 * missing object, which the next run deletes again.
 */
async function removeClientArtifacts(
  db: Db,
  deps: RemediationDeps,
  matchId: RiotMatchId,
): Promise<void> {
  for (const kind of ARTIFACT_KINDS) {
    const descriptor = await storedRawArchiveDescriptor(db, matchId, kind);
    if (descriptor !== null) await deps.objects.delete(descriptor.key);
  }
  await db.matchProcessingReceipt.deleteMany({
    where: {
      riotMatchId: matchId,
      kind: {
        in: [
          ...ARTIFACT_KINDS.map((kind) => rawArchiveReceiptKind(kind)),
          lakeStagingReceiptKind("match"),
          lakeStagingReceiptKind("timeline"),
        ],
      },
    },
  });
}

async function rederiveMatch(
  db: Db,
  deps: RemediationDeps,
  matchId: RiotMatchId,
): Promise<void> {
  // Fetch before deleting anything: if Riot fails now, nothing has changed.
  const match = await deps.riot.fetchMatch(matchId);
  if (match === undefined) {
    throw new Error(
      `Riot no longer returns ${matchId}; rerun to plan it as a delete`,
    );
  }
  const timeline = await deps.riot.fetchTimeline(matchId);
  await removeClientArtifacts(db, deps, matchId);
  const aliases = await trackedAliasesFor(db, match);
  await deps.ingestMatch(match, aliases);
  if (timeline !== undefined) {
    await deps.ingestTimeline(
      timeline,
      aliases,
      new Date(match.info.gameCreation),
    );
  }
  // The selection row goes last: while it exists a rerun still sees the
  // match as client-derived and repeats the steps above.
  await db.scoutClientCanonicalMatch.deleteMany({
    where: { riotMatchId: matchId },
  });
}

async function deleteMatch(
  db: Db,
  deps: RemediationDeps,
  matchId: RiotMatchId,
): Promise<void> {
  await removeClientArtifacts(db, deps, matchId);
  await db.scoutClientCanonicalMatch.deleteMany({
    where: { riotMatchId: matchId },
  });
}

async function deleteObservations(
  db: Db,
  deps: RemediationDeps,
  deviceIds: readonly string[],
): Promise<void> {
  const deviceFilter = { deviceId: { in: [...deviceIds] } };
  const archived = await db.scoutClientObservation.findMany({
    where: { ...deviceFilter, rawArchiveKey: { not: null } },
    select: { rawArchiveKey: true },
  });
  for (const row of archived) {
    if (row.rawArchiveKey !== null)
      await deps.objects.delete(row.rawArchiveKey);
  }
  const owned = { observation: deviceFilter };
  await db.scoutClientGameResult.deleteMany({ where: owned });
  await db.scoutClientPlayerSnapshot.deleteMany({ where: owned });
  await db.scoutClientClashEntity.deleteMany({ where: owned });
  await db.scoutClientCanonicalMatch.deleteMany({
    where: { sourceObservation: deviceFilter },
  });
  await db.scoutClientObservation.deleteMany({ where: deviceFilter });
  await db.leagueIdentityAlias.deleteMany({
    where: { learnedFromDeviceId: { in: [...deviceIds] } },
  });
}

/**
 * Carry out a plan. Every step is idempotent and ordered so that an
 * interrupted run is finished by running the script again:
 * revoke, then per-match artifacts, then raw evidence, then refreshes.
 */
export async function applyRemediationPlan(
  db: Db,
  plan: RemediationPlan,
  deps: RemediationDeps,
): Promise<void> {
  const log = (line: string): void => {
    deps.log?.(line);
  };
  const owners = new Map(plan.devices.map((d) => [d.id, d.ownerId]));
  for (const deviceId of plan.revokeDeviceIds) {
    const ownerId = owners.get(deviceId);
    if (ownerId === undefined) throw new Error(`Unknown device ${deviceId}`);
    await deps.revokeDevice(deviceId, ownerId);
    log(`revoked device ${deviceId}`);
  }
  for (const match of plan.matches) {
    if (match.action === "rederive")
      await rederiveMatch(db, deps, match.matchId);
    if (match.action === "delete") await deleteMatch(db, deps, match.matchId);
    log(`${match.action} ${match.matchId}`);
  }
  await deleteObservations(
    db,
    deps,
    plan.devices.map((device) => device.id),
  );
  log("deleted raw observations and learned aliases");
  await deps.refresh.rebuildLake();
  log("report lake rebuilt");
  await deps.refresh.refreshHallOfFame();
  log("Hall of Fame refreshed");
  await deps.refresh.refreshCompetitions();
  log("competitions refreshed");
}

const ArgsSchema = z
  .object({
    owner: z.string().min(1).optional(),
    device: z.string().min(1).optional(),
    apply: z.boolean(),
  })
  .refine(
    (args) => (args.owner === undefined) === (args.device !== undefined),
    {
      message: "Pass exactly one of --owner <userId> or --device <deviceId>",
    },
  );

export type RemediationArgs = {
  readonly scope: RemediationScope;
  readonly apply: boolean;
};

/** `--dry-run` is the default; `--apply` is required to change anything. */
export function parseRemediationArgs(argv: readonly string[]): RemediationArgs {
  const values: { owner?: string; device?: string } = {};
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    switch (arg) {
      case "--apply":
        apply = true;
        break;
      case "--dry-run":
        apply = false;
        break;
      case "--owner":
      case "--device": {
        const value = argv[index + 1];
        if (value === undefined) throw new Error(`${arg} requires a value`);
        values[arg === "--owner" ? "owner" : "device"] = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const parsed = ArgsSchema.parse({ ...values, apply });
  if (parsed.owner !== undefined) {
    return {
      apply,
      scope: {
        kind: "owner",
        ownerId: DiscordAccountIdSchema.parse(parsed.owner),
      },
    };
  }
  return { apply, scope: { kind: "device", deviceId: parsed.device ?? "" } };
}
