import { ApplicationFailure } from "@temporalio/common";
import {
  MatchIdSchema,
  type MatchId,
  type PlayerConfigEntry,
  type RawMatch,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  getAccountConfigsByPuuids,
  getAccountsWithState,
  prisma,
} from "#src/database/index.ts";
import { getObservation } from "#src/database/durable/observation-repository.ts";
import { listTrackedAccounts } from "#src/database/durable/tracked-account-repository.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { requireAuthoritativeMatchData } from "#src/league/tasks/postmatch/temporal-match-ingestion.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedMatchPayload } from "#src/report-lake/receipted-archive.ts";
import {
  readSelectedLocalCanonicalMatch,
  resolveLocalCanonicalMatch,
} from "#src/scout-client/canonical-match.ts";

/**
 * What every V2 per-match Activity needs before it can do anything: the
 * authoritative match payload, and which tracked accounts are in it. Riot is
 * preferred; a complete paired-client payload may fill the gap only after the
 * source-selection delay and is then fixed for retries.
 *
 * Each Activity resolves this for itself rather than receiving it from the
 * one before. That is not redundancy to be optimised away — it is what makes
 * the Activities independently retryable. An Activity that depended on a
 * previous Activity's in-memory payload could not be rescheduled onto another
 * worker after a crash, which is the only situation the V2 core exists to
 * survive. The alternative — carrying the payload through the Workflow — is
 * forbidden outright: a MatchV5 payload in a Workflow history is kept forever.
 *
 * ## Which roster, and why there are two resolvers
 *
 * `resolveScoutV2MatchContext` answers with the roster as it stands NOW.
 * {@link resolveScoutV2ObservedMatchContext} answers with the roster the
 * match's own observation RECORDED. The split is temporal, which is why it is
 * two functions rather than two fields: the present-roster resolver serves the
 * Activities that run BEFORE the observation commits, and the observed one
 * serves those that run after. A field would let the next reader pick whichever
 * name read better at the call site; a separately named function makes the
 * choice deliberate every time, and names which side of the commit it is on.
 */
export type ScoutV2MatchContext = {
  /** The loose v1 match id the task services take. */
  readonly matchId: MatchId;
  readonly riotMatchId: RiotMatchId;
  readonly matchData: RawMatch;
  /** Durable provenance of the canonical match payload. */
  readonly matchDataSource: "RIOT" | "SCOUT_CLIENT";
  /**
   * The tracked accounts in this match, as the roster stands NOW.
   *
   * Only correct for a caller that runs before the observation commits. Every
   * later consumer wants {@link ScoutV2ObservedMatchContext.trackedPlayers}.
   */
  readonly trackedPlayers: PlayerConfigEntry[];
};

async function readArchivedCanonicalMatch(
  riotMatchId: RiotMatchId,
): Promise<RawMatch | null> {
  const descriptor = await storedRawArchiveDescriptor(
    prisma,
    riotMatchId,
    "match",
  );
  return descriptor === null
    ? null
    : await readArchivedMatchPayload(descriptor, riotMatchId);
}

/**
 * The same payload, over the roster the observation recorded for this match.
 *
 * `observedPuuids` and `trackedPlayers` are two facts rather than two rosters:
 * the first is what the observation recorded, the second is those same PUUIDs'
 * configs as they can still be read. The second is SHORTER exactly when a
 * registration has been deleted since — deregistration hard-deletes the
 * `Account` row, and a config's alias, region and Discord identity live only
 * there, so such a PUUID has no config to rebuild from anything the database
 * still holds.
 */
export type ScoutV2ObservedMatchContext = {
  readonly matchId: MatchId;
  readonly riotMatchId: RiotMatchId;
  readonly matchData: RawMatch;
  /** Durable provenance of the canonical match payload. */
  readonly matchDataSource: "RIOT" | "SCOUT_CLIENT";
  /** Every PUUID the observation recorded as tracked in this match. */
  readonly observedPuuids: LeaguePuuid[];
  /** Those PUUIDs' configs, for the ones still registered. */
  readonly trackedPlayers: PlayerConfigEntry[];
};

/**
 * The match payload, routed by the match id's own prefix.
 *
 * The route does not depend on the roster at all. It previously did: the
 * resolver derived this same platform, searched the live accounts for one whose
 * region mapped back to it, and passed that region to a fetcher that mapped it
 * forward again. That round trip raised a non-retryable failure whenever no
 * tracked account remained on the match's platform, which stalled the whole
 * per-match pipeline at its first Activity for a match Scout had already
 * observed. `platformRouteOf` is also the only derivation
 * `MatchObservationRecordSchema` accepts, so the id is the source of truth for
 * this by construction.
 */
async function canonicalMatchData(
  matchId: MatchId,
  riotMatchId: RiotMatchId,
): Promise<{
  readonly matchData: RawMatch;
  readonly matchDataSource: "RIOT" | "SCOUT_CLIENT";
}> {
  const archived = await readArchivedCanonicalMatch(riotMatchId);
  const selectedLocal = await readSelectedLocalCanonicalMatch(riotMatchId);
  const riotMatch =
    archived === null && selectedLocal === null
      ? await fetchMatchData(
          matchId,
          platformRouteOf(riotMatchId),
          "return_undefined_on_404",
        )
      : undefined;
  const resolvedLocal =
    archived === null && selectedLocal === null && riotMatch === undefined
      ? await resolveLocalCanonicalMatch(riotMatchId)
      : null;
  return {
    matchData:
      archived ??
      selectedLocal ??
      riotMatch ??
      requireAuthoritativeMatchData(riotMatchId, resolvedLocal ?? undefined),
    matchDataSource:
      selectedLocal !== null || resolvedLocal !== null
        ? "SCOUT_CLIENT"
        : "RIOT",
  };
}

export async function resolveScoutV2MatchContext(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2MatchContext> {
  const matchId = MatchIdSchema.parse(riotMatchId);
  const accounts = await getAccountsWithState(prisma, getActiveServerIds());
  const allPlayerConfigs = accounts.map((account) => account.config);
  const { matchData, matchDataSource } = await canonicalMatchData(
    matchId,
    riotMatchId,
  );
  const participants = new Set<string>(matchData.metadata.participants);
  return {
    matchId,
    riotMatchId,
    matchData,
    matchDataSource,
    trackedPlayers: allPlayerConfigs.filter((config) =>
      participants.has(config.league.leagueAccount.puuid),
    ),
  };
}

/**
 * The PUUIDs this match's observation recorded as tracked in it.
 *
 * The two empty answers are different facts and must not collapse. NO
 * OBSERVATION is a caller reaching for the snapshot before it is written —
 * a programming error about ordering, which no retry fixes — so it fails
 * loudly. An observation that recorded NOBODY is legitimate and returns empty:
 * routing a match by its own id made a match with no tracked participant
 * reachable, and such a match is archived and cursored like any other.
 */
export async function observedTrackedPuuids(
  riotMatchId: RiotMatchId,
): Promise<LeaguePuuid[]> {
  const observation = await getObservation(prisma, { matchId: riotMatchId });
  if (observation === null) {
    throw ApplicationFailure.nonRetryable(
      `${riotMatchId} has no observation, so the roster it was observed for cannot be read; this caller runs before the observation commits`,
      "MissingDomainRecord",
    );
  }
  const tracked = await listTrackedAccounts(prisma, { matchId: riotMatchId });
  return tracked.map((account) => account.puuid);
}

/**
 * The context for every Activity that runs AFTER the observation commits.
 *
 * The roster is read from the durable snapshot rather than rebuilt from who is
 * tracked at the moment this Activity happens to run. Rebuilding asks a
 * different question, and the two questions diverge for a reason that has
 * nothing to do with the match: the live roster is narrowed by
 * `getActiveServerIds()`, a read of the Discord gateway's guild cache, which
 * answers `undefined` — no filter at all — in a process that owns no gateway.
 * Settlement, progression and the mint run on the `realtime` queue and the
 * render on `background`, so they are different worker pools and can hold
 * different cache state. The live roster therefore depends on WHICH PROCESS
 * ASKS, not only on when.
 *
 * The cost of that was a report silently dropped. The mint reads the snapshot,
 * so it mints the intents a match is owed and the Workflow advances the cursor;
 * the render rebuilt the roster, got an empty one, and failed with nothing left
 * to rediscover the match. Settlement and progression had the same exposure and
 * were quieter about it — progression writes the count it saw into its receipt,
 * so a shrunken roster becomes durable evidence attesting the wrong number.
 */
export async function resolveScoutV2ObservedMatchContext(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2ObservedMatchContext> {
  const matchId = MatchIdSchema.parse(riotMatchId);
  const { matchData, matchDataSource } = await canonicalMatchData(
    matchId,
    riotMatchId,
  );
  const observedPuuids = await observedTrackedPuuids(riotMatchId);
  return {
    matchId,
    riotMatchId,
    matchData,
    matchDataSource,
    observedPuuids,
    // The client is passed rather than defaulted, as every other read here
    // does: a default parameter closes over the database module's own `prisma`
    // binding, which an integration test's module mock cannot redirect.
    trackedPlayers: await getAccountConfigsByPuuids(observedPuuids, prisma),
  };
}
