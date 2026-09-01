import type { MatchId, PlayerConfigEntry } from "@scout-for-lol/data/index.ts";
import type { ScoutMatchIngestionInput } from "@scout-for-lol/temporal";
import type { PlayerWithMatchIds } from "#src/league/tasks/postmatch/match-processing.ts";

export type DiscoveredMatchIntent = Omit<ScoutMatchIngestionInput, "stage">;

export type MatchDiscovery = {
  complete: boolean;
  intents: DiscoveredMatchIntent[];
  allPlayerConfigs: PlayerConfigEntry[];
};

export type MatchCompletionResolver = (
  intent: DiscoveredMatchIntent,
) => Promise<number | undefined>;

export type MatchIntentOrderResult =
  | { kind: "ordered"; intents: DiscoveredMatchIntent[] }
  | { kind: "unavailable"; matchId: DiscoveredMatchIntent["matchId"] };

export async function orderMatchIntentsByCompletion(
  intents: readonly DiscoveredMatchIntent[],
  completionOf: MatchCompletionResolver,
): Promise<MatchIntentOrderResult> {
  const ranked = await Promise.all(
    intents.map(async (intent) => {
      const gameEndTimestamp = await completionOf(intent);
      return { gameEndTimestamp, intent };
    }),
  );
  const available: {
    gameEndTimestamp: number;
    intent: DiscoveredMatchIntent;
  }[] = [];
  for (const candidate of ranked) {
    if (candidate.gameEndTimestamp === undefined) {
      return { kind: "unavailable", matchId: candidate.intent.matchId };
    }
    available.push({
      gameEndTimestamp: candidate.gameEndTimestamp,
      intent: candidate.intent,
    });
  }
  return {
    kind: "ordered",
    intents: available
      .toSorted(
        (left, right) =>
          left.gameEndTimestamp - right.gameEndTimestamp ||
          left.intent.matchId.localeCompare(right.intent.matchId),
      )
      .map(({ intent }) => intent),
  };
}

export function deduplicateMatchIntents(
  playersWithMatches: PlayerWithMatchIds[],
): DiscoveredMatchIntent[] {
  const intents = new Map<MatchId, DiscoveredMatchIntent>();
  for (const { player, backfillMatchIds } of playersWithMatches) {
    for (const matchId of backfillMatchIds) {
      intents.set(matchId, {
        matchId,
        sourcePuuid: player.league.leagueAccount.puuid,
        region: player.league.leagueAccount.region,
        delivery: "silent-backfill",
      });
    }
  }
  for (const { player, matchIds } of playersWithMatches) {
    for (const matchId of matchIds) {
      intents.set(matchId, {
        matchId,
        sourcePuuid: player.league.leagueAccount.puuid,
        region: player.league.leagueAccount.region,
        delivery: "live",
      });
    }
  }
  return [...intents.values()];
}
