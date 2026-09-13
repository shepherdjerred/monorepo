import { ApplicationFailure } from "@temporalio/common";
import {
  MatchIdSchema,
  regionToPlatformRoute,
  type MatchId,
  type PlayerConfigEntry,
  type RawMatch,
  type Region,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { getAccountsWithState, prisma } from "#src/database/index.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { requireAuthoritativeMatchData } from "#src/league/tasks/postmatch/temporal-match-ingestion.ts";

/**
 * What every V2 per-match Activity needs before it can do anything: the
 * authoritative Riot payload, and which tracked accounts are in it.
 *
 * Each Activity resolves this for itself rather than receiving it from the
 * one before. That is not redundancy to be optimised away — it is what makes
 * the Activities independently retryable. An Activity that depended on a
 * previous Activity's in-memory payload could not be rescheduled onto another
 * worker after a crash, which is the only situation the V2 core exists to
 * survive. The alternative — carrying the payload through the Workflow — is
 * forbidden outright: a MatchV5 payload in a Workflow history is kept forever.
 */
export type ScoutV2MatchContext = {
  /** The loose v1 match id the task services take. */
  readonly matchId: MatchId;
  readonly riotMatchId: RiotMatchId;
  readonly matchData: RawMatch;
  /** Every tracked account that played in this match. */
  readonly trackedPlayers: PlayerConfigEntry[];
  /** Every tracked account, which is what the v1 pipeline's steps take. */
  readonly allPlayerConfigs: PlayerConfigEntry[];
};

/**
 * The region to fetch a match through, taken from a tracked account on the
 * match's own platform.
 *
 * Riot routes a MatchV5 read by regional route, and `platformToRegionalRoute`
 * derives that from either spelling — but `fetchMatchData` takes Scout's
 * `Region` label, and the match id carries the platform. Resolving one from a
 * tracked account rather than inverting the mapping here keeps a single source
 * of truth for the correspondence, and makes the failure honest: Scout
 * archives matches of accounts it tracks, so a match on a platform where it
 * tracks none is not a transient fault.
 */
function regionForPlatform(
  accounts: readonly PlayerConfigEntry[],
  riotMatchId: RiotMatchId,
): Region {
  const platform = platformRouteOf(riotMatchId);
  const region = accounts
    .map((config) => config.league.leagueAccount.region)
    .find((candidate) => regionToPlatformRoute(candidate) === platform);
  if (region === undefined) {
    throw ApplicationFailure.nonRetryable(
      `No tracked account plays on ${platform}, so ${riotMatchId} cannot be fetched`,
      "MissingDomainRecord",
    );
  }
  return region;
}

export async function resolveScoutV2MatchContext(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2MatchContext> {
  const matchId = MatchIdSchema.parse(riotMatchId);
  const accounts = await getAccountsWithState(prisma, getActiveServerIds());
  const allPlayerConfigs = accounts.map((account) => account.config);
  const matchData = requireAuthoritativeMatchData(
    riotMatchId,
    await fetchMatchData(
      matchId,
      regionForPlatform(allPlayerConfigs, riotMatchId),
    ),
  );
  const participants = new Set<string>(matchData.metadata.participants);
  return {
    matchId,
    riotMatchId,
    matchData,
    trackedPlayers: allPlayerConfigs.filter((config) =>
      participants.has(config.league.leagueAccount.puuid),
    ),
    allPlayerConfigs,
  };
}
