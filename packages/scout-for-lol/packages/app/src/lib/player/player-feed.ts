import {
  QueueTypeSchema,
  queueTypeToDisplayString,
  type PlayerId,
  type Rank,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { SCOUT_RANKS } from "@scout-for-lol/design-system/assets";
import type { GameResult } from "@scout-for-lol/design-system/domain/profile/result-strip";
import { relativeWhen } from "#src/lib/format/relative-time.ts";
import { multiKillLabel } from "#src/lib/player/player-page.ts";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";
import { rankName, rankParts } from "#src/lib/player/rank-parts.ts";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

export type HistoryEntry =
  RouterOutputs["consumerPlayer"]["matchHistory"]["entries"][number];
export type RankHistory = RouterOutputs["consumerPlayer"]["rankHistory"];

/** Games the feed reads, and how many it shows before "See all games". */
export const FEED_LIMIT = 20;
export const FEED_PREVIEW = 6;

/** What `matchHistory` reads: the newest games under the page's filters. */
export function playerHistoryInput(
  playerId: PlayerId,
  filters: PlayerProfileFilters,
) {
  return {
    playerId,
    limit: FEED_LIMIT,
    games: filters.games,
    ...(filters.queues === undefined ? {} : { queues: filters.queues }),
  };
}

/** "Ranked Solo": the queue's name with each word capitalised. */
export function queueLabel(queue: string | null): string | undefined {
  if (queue === null) return undefined;
  const parsed = QueueTypeSchema.safeParse(queue.toLowerCase());
  const name = parsed.success
    ? queueTypeToDisplayString(parsed.data)
    : queue.toLowerCase().replaceAll("_", " ");
  return name
    .split(" ")
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(" ");
}

export type FeedRow = {
  matchId: RiotMatchId;
  result: GameResult;
  championId: number;
  kda: { kills: number; deaths: number; assists: number };
  lpChange: number | undefined;
  when: string;
  detail: string | undefined;
  highlight: string | undefined;
};

/** One sentence per game, newest first. */
export function feedRows(
  entries: readonly HistoryEntry[],
  nowMs: number,
): FeedRow[] {
  return entries.map((entry) => ({
    matchId: entry.matchId,
    result: entry.win ? "win" : "loss",
    championId: entry.championId,
    kda: {
      kills: entry.kills,
      deaths: entry.deaths,
      assists: entry.assists,
    },
    lpChange: entry.leaguePointsDelta ?? undefined,
    when: relativeWhen(entry.gameCreationMs, nowMs),
    detail: queueLabel(entry.queue),
    highlight: multiKillLabel(entry.largestMultiKill),
  }));
}

export type SplitClimb = {
  /** Ladder points, oldest first. */
  points: number[];
  start: Rank;
  now: Rank;
  /** "Climbed from Platinum II to Emerald II in 79 ranked games." */
  sentence: string;
  /** The game that first reached the current tier, when it is a climb into one. */
  reached: { index: number; label: string } | undefined;
};

function ladderMove(start: Rank, now: Rank, games: number): string {
  const count = `${games.toString()} ranked ${games === 1 ? "game" : "games"}`;
  const from = rankName(start);
  const to = rankName(now);
  if (from === to) {
    const change = now.lp - start.lp;
    if (change === 0) return `Holding ${to} over ${count}.`;
    return `${change > 0 ? "Up" : "Down"} ${Math.abs(change).toString()} LP in ${count}.`;
  }
  const ordinal = (rank: Rank): number =>
    // Tier first, then division (1 is the top), then LP.
    SCOUT_RANKS.indexOf(rankParts(rank).rank) * 1000 -
    rank.division * 100 +
    rank.lp;
  return `${ordinal(now) > ordinal(start) ? "Climbed" : "Dropped"} from ${from} to ${to} in ${count}.`;
}

/**
 * This split's Solo/Duo climb, from the account with the most history. Null
 * until there are two points to draw a line between.
 */
export function splitClimb(history: RankHistory): SplitClimb | null {
  const series = history.queues.solo.series.toSorted(
    (left, right) => right.points.length - left.points.length,
  )[0];
  if (series === undefined) return null;
  const points = series.points.toSorted(
    (left, right) => new Date(left.at).getTime() - new Date(right.at).getTime(),
  );
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined || points.length < 2) {
    return null;
  }
  const nowTier = SCOUT_RANKS.indexOf(rankParts(last.rank).rank);
  const startTier = SCOUT_RANKS.indexOf(rankParts(first.rank).rank);
  const reachedAt =
    nowTier > startTier
      ? points.findIndex(
          (point) => SCOUT_RANKS.indexOf(rankParts(point.rank).rank) >= nowTier,
        )
      : -1;
  return {
    points: points.map((point) => point.leaguePoints),
    start: first.rank,
    now: last.rank,
    sentence: ladderMove(first.rank, last.rank, points.length - 1),
    reached:
      reachedAt > 0
        ? {
            index: reachedAt,
            label: `Reached ${rankParts(last.rank).rank}`,
          }
        : undefined,
  };
}
