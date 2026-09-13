import type { Db } from "#src/database/index.ts";
import {
  S3ObjectKeySchema,
  Sha256DigestSchema,
  type IsoInstant,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  AccountIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/domain/identity/database-ids.ts";
import { observeMatch } from "#src/database/durable/observation-repository.ts";
import { recordTrackedAccounts } from "#src/database/durable/tracked-account-repository.ts";
import type { MatchTrackedAccountRecord } from "#src/database/durable/tracked-account-row.ts";
import type { StoredArtifactReference } from "#src/database/durable/observation-row.ts";
import {
  recordDurableWrite,
  resolveDurableIdentity,
  type DurableFacts,
} from "#src/durable/match/durable-facts.ts";
import {
  isoInstantFromEpochMs,
  platformRouteOf,
  toIsoInstant,
  toRiotMatchId,
} from "#src/durable/match/match-identity.ts";

/**
 * The archive-request service: the typed boundary around v1's authoritative
 * archive step, which writes the canonical raw match to the object store and
 * stages it into the derived report lake.
 *
 * The service runs the v1 archive exactly as before and records what it
 * observed afterwards. Ordering matters: the durable facts are written only
 * once the archive has actually succeeded, so a match with an observation row
 * is a match whose raw payload really is canonical. A failure in `archive`
 * propagates untouched — it is the cursor gate, and swallowing it would lose
 * the match.
 *
 * What this service does NOT write is the `raw-archive` and `lake-staging`
 * receipts. Those belong to the receipted lake projection, which records them
 * from the writers that produce the artifact and therefore know its object key
 * and content digest. Here we only place the observation those receipts hang
 * off, and stamp the observation's artifact reference when the archive hands
 * one back.
 */

/**
 * What the v1 archive step reports back about one match.
 *
 * `artifact` is the raw payload's durable identity — object key plus content
 * digest — as v1's archive writer reported it. It is absent when no object was
 * written at all (the dev/test no-bucket path), and then the observation's
 * artifact columns stay NULL, which is exactly what NULL means there.
 *
 * The shape is structural rather than the object store's own descriptor
 * because this service must stay importable without `report-lake/`, which is
 * where the archive, the staging files and the receipts are composed.
 */
export type MatchArchiveOutcome = {
  readonly staged: boolean;
  readonly stored: boolean;
  readonly artifact?: { readonly key: string; readonly digest: string };
};

export type ArchivedMatchFacts = {
  /** v1's loose match id; parsed to a RiotMatchId inside the boundary. */
  readonly matchId: string;
  /** Riot's `info.gameCreation`, epoch milliseconds. */
  readonly gameCreation: number;
  /** Every tracked account seen in the match, by PUUID. */
  readonly trackedPuuids: readonly string[];
  /** v1's ingest source label, e.g. `postmatch_live`. */
  readonly source: string;
};

/**
 * Snapshot the registration behind each tracked PUUID.
 *
 * A PUUID can be registered in several guilds, so it has several `Account`
 * rows, while the association's grain is one row per (match, PUUID). The
 * lowest account id is the deterministic representative of that PUUID's
 * registration; a PUUID with no row at all stays NULL, which is exactly what
 * the column means.
 */
async function registrationsByPuuid(
  db: Db,
  puuids: readonly string[],
): Promise<Map<string, { accountId: number; playerId: number }>> {
  const accounts = await db.account.findMany({
    where: { puuid: { in: [...puuids] } },
    select: { id: true, playerId: true, puuid: true },
    orderBy: { id: "asc" },
  });
  const byPuuid = new Map<string, { accountId: number; playerId: number }>();
  for (const account of accounts) {
    if (byPuuid.has(account.puuid)) continue;
    byPuuid.set(account.puuid, {
      accountId: account.id,
      playerId: account.playerId,
    });
  }
  return byPuuid;
}

async function trackedAccountRecords(
  db: Db,
  matchId: RiotMatchId,
  puuids: readonly string[],
): Promise<MatchTrackedAccountRecord[]> {
  const registrations = await registrationsByPuuid(db, puuids);
  return puuids.map((puuid) => {
    const registration = registrations.get(puuid);
    return {
      matchId,
      puuid: LeaguePuuidSchema.parse(puuid),
      playerId:
        registration === undefined
          ? null
          : PlayerIdSchema.parse(registration.playerId),
      accountId:
        registration === undefined
          ? null
          : AccountIdSchema.parse(registration.accountId),
      cursorAdvancedAt: null,
    };
  });
}

/**
 * The raw payload's durable identity, parsed. NULL when the archive writer
 * returned none — never a key reconstructed from the layout convention, which
 * would be evidence of nothing.
 */
function artifactReference(
  artifact: MatchArchiveOutcome["artifact"],
): StoredArtifactReference | null {
  if (artifact === undefined) return null;
  return {
    key: S3ObjectKeySchema.parse(artifact.key),
    digest: Sha256DigestSchema.parse(artifact.digest),
  };
}

type ObservationArgs = {
  facts: DurableFacts;
  matchId: RiotMatchId;
  match: ArchivedMatchFacts;
  observedAt: IsoInstant;
  artifact: StoredArtifactReference | null;
};

async function recordObservation(args: ObservationArgs): Promise<void> {
  const { facts, matchId, match } = args;
  await recordDurableWrite(facts, "observation", async (db) =>
    observeMatch(db, {
      matchId,
      platformRoute: platformRouteOf(matchId),
      // The normal per-match pipeline runs every downstream effect, so the
      // policy is FULL even for a silent backfill: suppressing the Discord
      // report does not make the match archive-only.
      policy: "FULL",
      owner: { kind: "legacy-v1" },
      // Born FULL, so there is no promotion to record.
      promotion: null,
      gameCreatedAt: isoInstantFromEpochMs(match.gameCreation),
      observedAt: args.observedAt,
      // The timeline is fetched conditionally and by a different path, so this
      // service never has its identity to record.
      artifacts: { match: args.artifact, timeline: null },
    }),
  );

  await recordDurableWrite(facts, "tracked-accounts", async (db) => {
    const records = await trackedAccountRecords(
      db,
      matchId,
      match.trackedPuuids,
    );
    const written = await recordTrackedAccounts(db, records);
    // The repository counts rows rather than answering with an outcome: a
    // batch that wrote nothing new is the association already being recorded.
    return { outcome: written.recorded > 0 ? "applied" : "already-applied" };
  });
}

/**
 * Record that this pipeline saw the match and which accounts it tracked in it,
 * without attesting to an archive.
 *
 * This is the path for a match whose archive effect was already completed by
 * an earlier run: v1 skips the archive entirely, so there is no fresh artifact
 * identity to stamp, but the observation and the account associations are
 * still true — and the cursor advance that follows needs them to exist.
 */
export async function recordObservedMatch(args: {
  facts: DurableFacts;
  match: ArchivedMatchFacts;
}): Promise<void> {
  const matchId = resolveDurableIdentity(() =>
    toRiotMatchId(args.match.matchId),
  );
  if (matchId === null) return;
  await recordObservation({
    facts: args.facts,
    matchId,
    match: args.match,
    observedAt: toIsoInstant(args.facts.now()),
    artifact: null,
  });
}

/**
 * Run v1's authoritative archive for one match and record what it did.
 *
 * The returned value is `archive`'s own, unchanged, so the caller's gate logic
 * reads exactly as it did before this bridge existed.
 */
export async function requestMatchArchive(args: {
  facts: DurableFacts;
  match: ArchivedMatchFacts;
  archive: () => Promise<MatchArchiveOutcome>;
}): Promise<MatchArchiveOutcome> {
  const outcome = await args.archive();
  const matchId = resolveDurableIdentity(() =>
    toRiotMatchId(args.match.matchId),
  );
  if (matchId === null) return outcome;
  const artifact = resolveDurableIdentity(() =>
    artifactReference(outcome.artifact),
  );
  await recordObservation({
    facts: args.facts,
    matchId,
    match: args.match,
    observedAt: toIsoInstant(args.facts.now()),
    artifact,
  });
  return outcome;
}
