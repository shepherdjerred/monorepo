import type { User } from "#generated/prisma/client/index.js";
import { getChampionDisplayName, type QueueType } from "@scout-for-lol/data";
import { fetchChampionIndex } from "#src/reports/duckdb/consumer/pages/champion-index-reads.ts";
import {
  getChampionPagePeople,
  pageEntries,
} from "#src/trpc/router/consumer/consumer-champion-people.ts";
import { buildChampionIndex } from "#src/trpc/router/consumer/consumer-champion-index.ts";

/** How far back a tooltip's record reaches. Carried on the payload. */
export const TOOLTIP_WINDOW_DAYS = 90;
export const DAY_MS = 86_400_000;

/**
 * What Scout knows about a champion for a hover: the viewer's own record on
 * it and their friends' combined record, over the last
 * {@link TOOLTIP_WINDOW_DAYS} days.
 *
 * It is the champion index narrowed to one champion and one window, so the
 * numbers are the ones the Champions page shows: people are counted once
 * across accounts and servers, and "best" is the friend with the best win
 * rate among those with enough games for it to mean something.
 *
 * One lake statement on one slot; the people are read from PostgreSQL.
 */
export async function getChampionTooltipFacts(input: {
  user: User;
  championId: number;
  queues: QueueType[] | undefined;
  nowMs: number;
}) {
  const { people } = await getChampionPagePeople(input.user, undefined);
  const rows = await fetchChampionIndex({
    entries: pageEntries(people),
    games: "all",
    queues: input.queues,
    championId: input.championId,
    sinceMs: input.nowMs - TOOLTIP_WINDOW_DAYS * DAY_MS,
  });
  const entry = buildChampionIndex({ rows, people }).find(
    (candidate) => candidate.championId === input.championId,
  );
  const you = entry?.you ?? null;
  const friendGames = entry === undefined ? 0 : entry.games - (you?.games ?? 0);
  const friendWins = entry === undefined ? 0 : entry.wins - (you?.wins ?? 0);
  const best = entry?.bestFriend ?? null;
  return {
    kind: "champion" as const,
    champion: {
      championId: input.championId,
      name: getChampionDisplayName(input.championId),
    },
    windowDays: TOOLTIP_WINDOW_DAYS,
    you:
      you === null
        ? null
        : { games: you.games, wins: you.wins, winRate: you.winRate },
    friends:
      entry === undefined || entry.friendCount === 0
        ? null
        : {
            players: entry.friendCount,
            games: friendGames,
            wins: friendWins,
            best:
              best === null
                ? null
                : {
                    playerId: best.playerId,
                    alias: best.alias,
                    games: best.games,
                    wins: best.wins,
                    winRate: best.winRate,
                    lowSample: !best.qualified,
                  },
          },
  };
}
