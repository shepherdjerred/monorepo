import type { DiscordAccountId } from "@scout-for-lol/data";
import type { buildCommunityInsights } from "#src/trpc/router/consumer/community-insights.ts";
import type { GuildMatchRow } from "#src/reports/duckdb/community/community-lake.ts";
import {
  playerRef,
  type ServerPlayer,
} from "#src/trpc/router/consumer/server/server-people.ts";

type Insights = ReturnType<typeof buildCommunityInsights>;

/** Two players on a team once is a coincidence, not a duo. */
export const MIN_DUO_GAMES = 2;
export const DUO_LIMIT = 3;
export const PLAYED_CHAMPION_LIMIT = 3;

/**
 * The most-played pairs of tracked players, from the insights' team pairs. The
 * viewer, when in the pair, comes first.
 */
export function buildDuos(input: {
  pairs: Insights["pairs"];
  players: ServerPlayer[];
  viewerDiscordId: DiscordAccountId;
}) {
  const byId = new Map(input.players.map((player) => [player.id, player]));
  return input.pairs
    .filter((pair) => pair.games >= MIN_DUO_GAMES)
    .toSorted(
      (left, right) =>
        right.games - left.games ||
        right.wins - left.wins ||
        left.firstId - right.firstId ||
        left.secondId - right.secondId,
    )
    .slice(0, DUO_LIMIT)
    .map((pair) => {
      const first = byId.get(pair.firstId);
      const second = byId.get(pair.secondId);
      if (first === undefined || second === undefined) {
        throw new Error("A duo named a player outside the server");
      }
      const both = [first, second].map((player) =>
        playerRef(player, input.viewerDiscordId),
      );
      return {
        players: both.toSorted(
          (left, right) => Number(right.isYou) - Number(left.isYou),
        ),
        games: pair.games,
        wins: pair.wins,
      };
    });
}

/** The champions the server plays most, summed over every player's games. */
export function buildPlays(input: {
  coverage: Insights["coverage"];
  rows: GuildMatchRow[];
}) {
  const idByName = new Map(
    input.rows.map((row) => [row.champion_name, row.champion_id] as const),
  );
  const games = new Map<string, number>();
  for (const entry of input.coverage) {
    games.set(entry.champion, (games.get(entry.champion) ?? 0) + entry.games);
  }
  return {
    champions: [...games]
      .toSorted(
        ([leftName, leftGames], [rightName, rightGames]) =>
          rightGames - leftGames || leftName.localeCompare(rightName),
      )
      .slice(0, PLAYED_CHAMPION_LIMIT)
      .map(([championName]) => {
        const championId = idByName.get(championName);
        if (championId === undefined) {
          throw new Error(`Champion ${championName} has no id in the scan`);
        }
        return { championId, championName };
      }),
  };
}
