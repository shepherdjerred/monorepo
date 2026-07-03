// Pure aggregation + formatting for the player-history review context. No DB, no
// clock, no logging — everything is injected — so this is fully unit-testable.
// The DB fetch that produces the inputs lives in player-history.ts.

import { z } from "zod";
import {
  laneToString,
  LaneSchema,
  type Lane,
  RankSchema,
  rankToLeaguePoints,
  rankToSimpleString,
  tierToPercentileString,
} from "@scout-for-lol/data/index.ts";

const RANK_LOOKBACK_GAMES = 10;
const MIN_GAMES_FOR_OFF_POOL = 3;
const TOP_CHAMPIONS = 4;
const TOP_DUOS = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

/** One past game for the reviewed player (current match excluded). */
export type HistoryGame = {
  matchId: string;
  gameCreationAt: Date;
  championName: string;
  lane: Lane | undefined;
  queue: string | undefined;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  durationSeconds: number;
  teamId: number;
};

/** A solo-queue rank snapshot before/after a past game. */
export type RankPoint = {
  matchGameEndAt: Date;
  rankBefore: z.infer<typeof RankSchema> | undefined;
  rankAfter: z.infer<typeof RankSchema> | undefined;
};

/** A tracked teammate's result in one shared game. */
export type TeammateResult = {
  alias: string;
  win: boolean;
};

/** The match being reviewed, for "this game" comparisons. */
export type CurrentGameContext = {
  championName: string;
  lane: Lane | undefined;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  durationSeconds: number;
};

export type PlayerHistoryInput = {
  games: HistoryGame[];
  rankPoints: RankPoint[];
  teammates: TeammateResult[];
  currentGame: CurrentGameContext;
  now: Date;
};

const StreakSchema = z.object({
  type: z.enum(["win", "loss", "none"]),
  count: z.number().nonnegative(),
});

const ChampionRecordSchema = z.object({
  champion: z.string(),
  games: z.number().nonnegative(),
  wins: z.number().nonnegative(),
});

export const PlayerHistorySignalsSchema = z.object({
  gamesInWindow: z.number().nonnegative(),
  recentWinrate: z.number().min(0).max(1),
  lastTen: z.object({
    wins: z.number().nonnegative(),
    losses: z.number().nonnegative(),
  }),
  streak: StreakSchema,
  gamesToday: z.number().nonnegative(),
  gamesThisWeek: z.number().nonnegative(),
  rankNow: RankSchema.optional(),
  rankAgo: RankSchema.optional(),
  lpThisWeek: z.number().optional(),
  championPool: z.array(ChampionRecordSchema),
  thisGameChampion: ChampionRecordSchema.extend({
    offPool: z.boolean(),
    firstTime: z.boolean(),
  }),
  mainLane: z
    .object({ lane: LaneSchema, games: z.number(), total: z.number() })
    .optional(),
  offRole: z.boolean(),
  performance: z
    .object({
      thisKda: z.number(),
      avgKda: z.number(),
      thisCsPerMin: z.number().optional(),
      avgCsPerMin: z.number().optional(),
    })
    .optional(),
  duos: z.array(
    z.object({
      alias: z.string(),
      wins: z.number().nonnegative(),
      losses: z.number().nonnegative(),
    }),
  ),
});
export type PlayerHistorySignals = z.infer<typeof PlayerHistorySignalsSchema>;

// ============================================================================
// Aggregation
// ============================================================================

function kda(kills: number, deaths: number, assists: number): number {
  return deaths === 0 ? kills + assists : (kills + assists) / deaths;
}

function laDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(date);
}

function computeStreak(games: HistoryGame[]): PlayerHistorySignals["streak"] {
  const first = games[0];
  if (first === undefined) {
    return { type: "none", count: 0 };
  }
  let count = 0;
  for (const game of games) {
    if (game.win === first.win) {
      count++;
    } else {
      break;
    }
  }
  return { type: first.win ? "win" : "loss", count };
}

function championRecords(
  games: HistoryGame[],
): { champion: string; games: number; wins: number }[] {
  const byChampion = new Map<string, { games: number; wins: number }>();
  for (const game of games) {
    const entry = byChampion.get(game.championName) ?? { games: 0, wins: 0 };
    entry.games++;
    if (game.win) {
      entry.wins++;
    }
    byChampion.set(game.championName, entry);
  }
  return [...byChampion.entries()]
    .map(([champion, rec]) => ({ champion, games: rec.games, wins: rec.wins }))
    .toSorted((a, b) => b.games - a.games || b.wins - a.wins);
}

function mainLaneOf(
  games: HistoryGame[],
): PlayerHistorySignals["mainLane"] | undefined {
  const byLane = new Map<Lane, number>();
  for (const game of games) {
    if (game.lane !== undefined) {
      byLane.set(game.lane, (byLane.get(game.lane) ?? 0) + 1);
    }
  }
  const ranked = [...byLane.entries()].toSorted((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (top === undefined) {
    return undefined;
  }
  const total = [...byLane.values()].reduce((sum, n) => sum + n, 0);
  return { lane: top[0], games: top[1], total };
}

function lpThisWeekOf(rankPoints: RankPoint[], now: Date): number | undefined {
  const cutoff = now.getTime() - WEEK_MS;
  const inWindow = rankPoints
    .filter((point) => point.matchGameEndAt.getTime() >= cutoff)
    .toSorted(
      (a, b) => a.matchGameEndAt.getTime() - b.matchGameEndAt.getTime(),
    );
  const first = inWindow[0];
  const last = inWindow.at(-1);
  if (first?.rankBefore === undefined || last?.rankAfter === undefined) {
    return undefined;
  }
  return (
    rankToLeaguePoints(last.rankAfter) - rankToLeaguePoints(first.rankBefore)
  );
}

function performanceOf(
  games: HistoryGame[],
  currentGame: CurrentGameContext,
): PlayerHistorySignals["performance"] | undefined {
  if (games.length === 0) {
    return undefined;
  }
  const avgKda =
    games.reduce((sum, g) => sum + kda(g.kills, g.deaths, g.assists), 0) /
    games.length;
  const thisKda = kda(
    currentGame.kills,
    currentGame.deaths,
    currentGame.assists,
  );
  const result: PlayerHistorySignals["performance"] = { thisKda, avgKda };
  const csGames = games.filter((g) => g.durationSeconds > 0);
  if (csGames.length > 0 && currentGame.durationSeconds > 0) {
    result.avgCsPerMin =
      csGames.reduce(
        (sum, g) => sum + g.creepScore / (g.durationSeconds / 60),
        0,
      ) / csGames.length;
    result.thisCsPerMin =
      currentGame.creepScore / (currentGame.durationSeconds / 60);
  }
  return result;
}

function duoRecords(teammates: TeammateResult[]): PlayerHistorySignals["duos"] {
  const byAlias = new Map<string, { wins: number; losses: number }>();
  for (const teammate of teammates) {
    const entry = byAlias.get(teammate.alias) ?? { wins: 0, losses: 0 };
    if (teammate.win) {
      entry.wins++;
    } else {
      entry.losses++;
    }
    byAlias.set(teammate.alias, entry);
  }
  return [...byAlias.entries()]
    .map(([alias, rec]) => ({ alias, wins: rec.wins, losses: rec.losses }))
    .toSorted((a, b) => b.wins + b.losses - (a.wins + a.losses))
    .slice(0, TOP_DUOS);
}

/**
 * Compute the structured history signals from already-fetched rows. Pure — no
 * DB, no clock. `now` is injected for deterministic testing.
 */
export function computePlayerHistorySignals(
  input: PlayerHistoryInput,
): PlayerHistorySignals {
  const { games, rankPoints, teammates, currentGame, now } = input;

  const wins = games.filter((g) => g.win).length;
  const lastTenGames = games.slice(0, 10);
  const pool = championRecords(games);

  const currentChampRecord = pool.find(
    (rec) => rec.champion === currentGame.championName,
  ) ?? { champion: currentGame.championName, games: 0, wins: 0 };
  const topChampionNames = new Set(pool.slice(0, 3).map((rec) => rec.champion));
  const offPool =
    !topChampionNames.has(currentGame.championName) &&
    currentChampRecord.games < MIN_GAMES_FOR_OFF_POOL;

  const mainLane = mainLaneOf(games);
  const offRole =
    mainLane !== undefined &&
    currentGame.lane !== undefined &&
    currentGame.lane !== mainLane.lane;

  const todayKey = laDateString(now);
  const gamesToday = games.filter(
    (g) => laDateString(g.gameCreationAt) === todayKey,
  ).length;
  const weekCutoff = now.getTime() - WEEK_MS;
  const gamesThisWeek = games.filter(
    (g) => g.gameCreationAt.getTime() >= weekCutoff,
  ).length;

  const sortedRank = rankPoints.toSorted(
    (a, b) => b.matchGameEndAt.getTime() - a.matchGameEndAt.getTime(),
  );
  const rankNow = sortedRank[0]?.rankAfter;
  const rankAgoPoint =
    sortedRank[Math.min(RANK_LOOKBACK_GAMES - 1, sortedRank.length - 1)];
  const rankAgo = rankAgoPoint?.rankAfter;

  const signals: PlayerHistorySignals = {
    gamesInWindow: games.length,
    recentWinrate: games.length > 0 ? wins / games.length : 0,
    lastTen: {
      wins: lastTenGames.filter((g) => g.win).length,
      losses: lastTenGames.filter((g) => !g.win).length,
    },
    streak: computeStreak(games),
    gamesToday,
    gamesThisWeek,
    championPool: pool.slice(0, TOP_CHAMPIONS),
    thisGameChampion: {
      champion: currentChampRecord.champion,
      games: currentChampRecord.games,
      wins: currentChampRecord.wins,
      offPool,
      firstTime: currentChampRecord.games === 0,
    },
    offRole,
    duos: duoRecords(teammates),
  };
  if (rankNow !== undefined) {
    signals.rankNow = rankNow;
  }
  if (rankAgo !== undefined) {
    signals.rankAgo = rankAgo;
  }
  const lpThisWeek = lpThisWeekOf(rankPoints, now);
  if (lpThisWeek !== undefined) {
    signals.lpThisWeek = lpThisWeek;
  }
  if (mainLane !== undefined) {
    signals.mainLane = mainLane;
  }
  const performance = performanceOf(games, currentGame);
  if (performance !== undefined) {
    signals.performance = performance;
  }
  return signals;
}

// ============================================================================
// Formatting
// ============================================================================

function pct(fraction: number): string {
  return `${Math.round(fraction * 100).toString()}%`;
}

function formatStreak(streak: PlayerHistorySignals["streak"]): string {
  if (streak.type === "none" || streak.count === 0) {
    return "no active streak";
  }
  const plural = streak.count === 1 ? "" : "es";
  return streak.type === "win"
    ? `${streak.count.toString()}-game win streak`
    : `${streak.count.toString()} loss${plural} in a row`;
}

function formatChampionRecord(rec: {
  champion: string;
  games: number;
  wins: number;
}): string {
  const winrate = rec.games > 0 ? pct(rec.wins / rec.games) : "—";
  return `${rec.champion} ${rec.games.toString()}g/${winrate}`;
}

function formatRankLine(signals: PlayerHistorySignals): string | undefined {
  if (signals.rankNow === undefined) {
    return undefined;
  }
  const parts = [
    `Now: ${rankToSimpleString(signals.rankNow)} (${tierToPercentileString(signals.rankNow.tier)} of players)`,
  ];
  if (signals.rankAgo !== undefined) {
    const delta =
      rankToLeaguePoints(signals.rankNow) - rankToLeaguePoints(signals.rankAgo);
    const dir =
      delta === 0
        ? "flat"
        : delta > 0
          ? `+${delta.toString()} LP`
          : `${delta.toString()} LP`;
    parts.push(
      `${RANK_LOOKBACK_GAMES.toString()} games ago: ${rankToSimpleString(signals.rankAgo)} (${dir})`,
    );
  }
  if (signals.lpThisWeek !== undefined && signals.lpThisWeek !== 0) {
    const sign = signals.lpThisWeek > 0 ? "+" : "";
    parts.push(`${sign}${signals.lpThisWeek.toString()} LP this week`);
  }
  return `RANK — ${parts.join(" · ")}`;
}

function formatChampsLine(signals: PlayerHistorySignals): string {
  const pool = signals.championPool
    .map((rec) => formatChampionRecord(rec))
    .join(", ");
  const tg = signals.thisGameChampion;
  const flags: string[] = [];
  if (tg.firstTime) {
    flags.push("first time on it");
  } else if (tg.offPool) {
    flags.push("off-pool");
  }
  const tgWinrate = tg.games > 0 ? pct(tg.wins / tg.games) : "no prior games";
  const flagText = flags.length > 0 ? `${flags.join(", ")}, ` : "";
  return `CHAMPS (last ${signals.gamesInWindow.toString()}) — Main: ${pool || "n/a"} · This game: ${tg.champion} (${flagText}${tgWinrate})`;
}

function formatPerformanceLine(
  performance: NonNullable<PlayerHistorySignals["performance"]>,
): string {
  const rel = performance.thisKda >= performance.avgKda ? "at/above" : "below";
  const parts = [
    `KDA ${performance.thisKda.toFixed(1)} vs avg ${performance.avgKda.toFixed(1)} (${rel})`,
  ];
  if (
    performance.thisCsPerMin !== undefined &&
    performance.avgCsPerMin !== undefined
  ) {
    parts.push(
      `CS/min ${performance.thisCsPerMin.toFixed(1)} vs avg ${performance.avgCsPerMin.toFixed(1)}`,
    );
  }
  return `PERFORMANCE — ${parts.join("; ")}`;
}

/**
 * Render the labeled history block for the prompt. Empty window → "" so the
 * prompt falls back to "No recent match history available."
 */
export function formatPlayerHistory(signals: PlayerHistorySignals): string {
  if (signals.gamesInWindow === 0) {
    return "";
  }
  const lines: string[] = [];

  lines.push(
    `RECENT FORM — ${formatStreak(signals.streak)} · Last 10: ${signals.lastTen.wins.toString()}W-${signals.lastTen.losses.toString()}L (${pct(signals.recentWinrate)} over last ${signals.gamesInWindow.toString()}) · Today: ${signals.gamesToday.toString()} games · This week: ${signals.gamesThisWeek.toString()}`,
  );

  const rankLine = formatRankLine(signals);
  if (rankLine !== undefined) {
    lines.push(rankLine);
  }

  lines.push(formatChampsLine(signals));

  if (signals.mainLane !== undefined) {
    const laneLabel = laneToString(signals.mainLane.lane);
    const offRole = signals.offRole ? " · off-role this game" : "";
    lines.push(
      `LANE — Main: ${laneLabel} (${signals.mainLane.games.toString()}/${signals.mainLane.total.toString()} games)${offRole}`,
    );
  }

  if (signals.performance !== undefined) {
    lines.push(formatPerformanceLine(signals.performance));
  }

  if (signals.duos.length > 0) {
    const duos = signals.duos
      .map(
        (duo) =>
          `with ${duo.alias} ${duo.wins.toString()}-${duo.losses.toString()}`,
      )
      .join(" · ");
    lines.push(`DUOS — ${duos}`);
  }

  return lines.join("\n");
}
