import {
  LeaguePuuidSchema,
  MatchIdSchema,
  RegionSchema,
  type MatchId,
  type RawMatch,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { getAccountsWithState } from "#src/database/player-accounts.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { processMatchAndUpdatePlayers } from "#src/league/tasks/postmatch/match-history-polling.ts";
import type { DiscoveredMatchIntent } from "#src/league/tasks/postmatch/match-intents.ts";

export function requireAuthoritativeMatchData(
  matchId: string,
  matchData: RawMatch | undefined,
): RawMatch {
  if (matchData === undefined) {
    throw new Error(`Authoritative match data is unavailable for ${matchId}`);
  }
  return matchData;
}

export async function ingestDiscoveredMatch(
  input: DiscoveredMatchIntent,
): Promise<void> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const sourcePuuid = LeaguePuuidSchema.parse(input.sourcePuuid);
  const region = RegionSchema.parse(input.region);
  // No live-guild filter. This roster is the match's tracked-account snapshot
  // (`recordTrackedAccounts`, which the V2 observed-roster resolver reads) and
  // its settlement audience, not a polling workload. `getActiveServerIds()`
  // fails open while the gateway is not ready but NARROWS once it is, so a guild
  // removed mid-match would silently drop its players from the record, and the
  // answer would depend on which process ran the Activity.
  const allAccounts = await getAccountsWithState(prisma);
  const source = allAccounts.find(
    ({ config }) =>
      config.league.leagueAccount.puuid === sourcePuuid &&
      config.league.leagueAccount.region === region,
  );
  if (source === undefined) {
    throw new Error(
      `Tracked source account ${input.sourcePuuid} is unavailable for ${input.matchId}`,
    );
  }
  const matchData = requireAuthoritativeMatchData(
    input.matchId,
    await fetchMatchData(matchId, region),
  );
  await processMatchAndUpdatePlayers({
    matchData,
    allPlayerConfigs: allAccounts.map((account) => account.config),
    processedMatchIds: new Set<MatchId>(),
    matchId,
    silent: input.delivery === "silent-backfill",
  });
}
