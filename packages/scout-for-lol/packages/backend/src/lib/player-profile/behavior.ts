import {
  computeKda,
  getCurrentSeason,
  type QueueType,
} from "@scout-for-lol/data";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  readPlayerMatchHistory,
  type LakePlayerMatchHistoryRow,
} from "#src/reports/duckdb/lake-reads.ts";

function formMetrics(rows: LakePlayerMatchHistoryRow[]) {
  if (rows.length === 0) return null;
  const minutes = rows.reduce((sum, row) => sum + row.time_played / 60, 0);
  return {
    games: rows.length,
    wins: rows.filter((row) => row.win).length,
    kda: computeKda({
      kills: rows.reduce((sum, row) => sum + row.kills, 0),
      deaths: rows.reduce((sum, row) => sum + row.deaths, 0),
      assists: rows.reduce((sum, row) => sum + row.assists, 0),
    }),
    csPerMinute:
      minutes > 0
        ? rows.reduce((sum, row) => sum + row.creep_score, 0) / minutes
        : 0,
  };
}

/**
 * The run of identical results ending at the newest game. `atLeast` is set
 * when the read hit its 1000-game ceiling inside the run.
 */
export type PlayerStreak = {
  result: "win" | "loss";
  games: number;
  atLeast: boolean;
};

function recordedStreak(
  rows: LakePlayerMatchHistoryRow[],
): PlayerStreak | null {
  const first = rows[0];
  if (first === undefined) return null;
  const games = rows.findIndex((row) => row.win !== first.win);
  return {
    result: first.win ? "win" : "loss",
    games: games === -1 ? rows.length : games,
    atLeast: games === -1 && rows.length === 1000,
  };
}

/** Runs on the caller's lake page: the profile reads share one slot. */
export async function buildPlayerBehavior(
  page: LakePage,
  options: {
    puuids: string[];
    recentRows: LakePlayerMatchHistoryRow[];
    roleShare: { position: string; games: number; percentage: number }[];
    queue?: QueueType;
    queues?: QueueType[];
  },
) {
  const act = getCurrentSeason();
  const filters = {
    puuids: options.puuids,
    ...(options.queue === undefined ? {} : { queue: options.queue }),
    ...(options.queues === undefined ? {} : { queues: options.queues }),
  };
  const actRows =
    act === undefined
      ? null
      : await readPlayerMatchHistory(page, {
          ...filters,
          afterMs: act.startDate.getTime(),
        });
  const streakRows = await readPlayerMatchHistory(page, {
    ...filters,
    limit: 1000,
  });
  return {
    roleShare: options.roleShare,
    activityTimes: options.recentRows.map((row) => row.game_creation_ms),
    streak: recordedStreak(streakRows),
    recent20: formMetrics(options.recentRows.slice(0, 20)),
    currentAct:
      act === undefined || actRows === null
        ? null
        : { name: act.displayName, form: formMetrics(actRows) },
  };
}
