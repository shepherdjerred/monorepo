import {
  LeaguePuuidSchema,
  MatchIdSchema,
  RegionSchema,
  type MatchId,
} from "@scout-for-lol/data/index.ts";
import {
  getAccountsWithState,
  prisma,
  updateLastProcessedMatch,
} from "#src/database/index.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { processMatchAndUpdatePlayers } from "#src/league/tasks/postmatch/match-history-polling.ts";
import type { DiscoveredMatchIntent } from "#src/league/tasks/postmatch/match-intents.ts";

export async function ingestDiscoveredMatch(
  input: DiscoveredMatchIntent,
): Promise<void> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const sourcePuuid = LeaguePuuidSchema.parse(input.sourcePuuid);
  const region = RegionSchema.parse(input.region);
  const allAccounts = await getAccountsWithState(prisma, getActiveServerIds());
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
  const matchData = await fetchMatchData(matchId, region);
  if (matchData === undefined) {
    await updateLastProcessedMatch(sourcePuuid, matchId);
    return;
  }
  await processMatchAndUpdatePlayers({
    matchData,
    allPlayerConfigs: allAccounts.map((account) => account.config),
    processedMatchIds: new Set<MatchId>(),
    matchId,
    silent: input.delivery === "silent-backfill",
  });
}
