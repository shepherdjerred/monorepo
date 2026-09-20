import {
  MatchIdSchema,
  type MatchId,
  type PlayerConfigEntry,
  type RawMatch,
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
};

export async function resolveScoutV2MatchContext(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2MatchContext> {
  const matchId = MatchIdSchema.parse(riotMatchId);
  // The route comes from the match id's own prefix, so fetching does not
  // depend on the roster at all. It previously did: the resolver derived this
  // same platform, searched the live accounts for one whose region mapped back
  // to it, and passed that region to a fetcher that mapped it forward again.
  // That round trip raised a non-retryable failure whenever no tracked account
  // remained on the match's platform, which stalled the whole per-match
  // pipeline at its first Activity for a match Scout had already observed.
  // `platformRouteOf` is also the only derivation `MatchObservationRecordSchema`
  // accepts, so the id is the source of truth for this by construction.
  const matchData = requireAuthoritativeMatchData(
    riotMatchId,
    await fetchMatchData(matchId, platformRouteOf(riotMatchId)),
  );
  const accounts = await getAccountsWithState(prisma, getActiveServerIds());
  const participants = new Set<string>(matchData.metadata.participants);
  return {
    matchId,
    riotMatchId,
    matchData,
    trackedPlayers: accounts
      .map((account) => account.config)
      .filter((config) => participants.has(config.league.leagueAccount.puuid)),
  };
}
