import type { PlayerConfigEntry } from "#src/model/player-config.ts";
import type { RawMatch } from "#src/league/raw-match.schema.ts";

const THRESHOLDS = {
  fastGameSeconds: 20 * 60,
  highKda: 5,
  longGameSeconds: 40 * 60,
  lowKda: 0.5,
  manyDeaths: 10,
  minDeathsForLowKda: 5,
  minKillsForHighKda: 5,
  minParticipationForPerfectGame: 5,
  stompParticipationKda: 2,
};

export type ExceptionalGameResult =
  | { isExceptional: false }
  | {
      isExceptional: true;
      performancePolarity: "negative" | "neutral" | "positive";
      reason: string;
    };

export type ExceptionalParticipantStats = {
  kills: number;
  deaths: number;
  assists: number;
  pentaKills: number;
  quadraKills: number;
  win: boolean;
  gameEndedInEarlySurrender: boolean;
};

function calculateKda(stats: ExceptionalParticipantStats): number {
  return stats.deaths === 0
    ? Infinity
    : (stats.kills + stats.assists) / stats.deaths;
}

function exceptionallyGood(
  stats: ExceptionalParticipantStats,
): ExceptionalGameResult | undefined {
  const kda = calculateKda(stats);
  if (stats.pentaKills > 0) {
    return {
      isExceptional: true,
      performancePolarity: "positive",
      reason: "pentakill",
    };
  }
  if (stats.quadraKills > 0)
    return {
      isExceptional: true,
      performancePolarity: "positive",
      reason: "quadrakill",
    };
  if (
    stats.deaths === 0 &&
    stats.win &&
    stats.kills + stats.assists >= THRESHOLDS.minParticipationForPerfectGame
  ) {
    return {
      isExceptional: true,
      performancePolarity: "positive",
      reason: "perfect game (0 deaths with win)",
    };
  }
  if (
    kda >= THRESHOLDS.highKda &&
    stats.kills >= THRESHOLDS.minKillsForHighKda
  ) {
    return {
      isExceptional: true,
      performancePolarity: "positive",
      reason: `high KDA (${kda.toFixed(1)})`,
    };
  }
  return undefined;
}

function exceptionallyBad(
  stats: ExceptionalParticipantStats,
): ExceptionalGameResult | undefined {
  const kda = calculateKda(stats);
  if (stats.deaths >= THRESHOLDS.manyDeaths) {
    return {
      isExceptional: true,
      performancePolarity: "negative",
      reason: `many deaths (${stats.deaths.toString()})`,
    };
  }
  if (
    kda <= THRESHOLDS.lowKda &&
    stats.deaths >= THRESHOLDS.minDeathsForLowKda
  ) {
    return {
      isExceptional: true,
      performancePolarity: "negative",
      reason: `very bad KDA (${kda.toFixed(1)})`,
    };
  }
  if (stats.gameEndedInEarlySurrender && !stats.win) {
    return {
      isExceptional: true,
      performancePolarity: "negative",
      reason: "early surrender loss",
    };
  }
  return undefined;
}

function durationExtreme(
  stats: ExceptionalParticipantStats,
  durationInSeconds: number,
): ExceptionalGameResult | undefined {
  const kda = calculateKda(stats);
  if (durationInSeconds < THRESHOLDS.fastGameSeconds) {
    if (stats.win && kda >= THRESHOLDS.stompParticipationKda) {
      return {
        isExceptional: true,
        performancePolarity: "positive",
        reason: "fast win (stomp)",
      };
    }
    if (!stats.win && kda < 1) {
      return {
        isExceptional: true,
        performancePolarity: "negative",
        reason: "fast loss (stomped)",
      };
    }
  }
  if (durationInSeconds > THRESHOLDS.longGameSeconds) {
    return {
      isExceptional: true,
      performancePolarity: "neutral",
      reason: "very long game",
    };
  }
  return undefined;
}

export function classifyExceptionalPerformance(
  stats: ExceptionalParticipantStats,
  durationInSeconds: number,
): ExceptionalGameResult {
  return (
    exceptionallyGood(stats) ??
    exceptionallyBad(stats) ??
    durationExtreme(stats, durationInSeconds) ?? { isExceptional: false }
  );
}

export function isExceptionalGame(
  matchData: RawMatch,
  player: PlayerConfigEntry,
  durationInSeconds: number,
): ExceptionalGameResult {
  const participant = matchData.info.participants.find(
    (candidate) => candidate.puuid === player.league.leagueAccount.puuid,
  );
  if (participant === undefined) {
    throw new Error(
      `Selected player ${player.alias} (${player.league.leagueAccount.puuid}) is absent from raw match ${matchData.metadata.matchId}`,
    );
  }
  return classifyExceptionalPerformance(
    {
      assists: participant.assists,
      deaths: participant.deaths,
      gameEndedInEarlySurrender: participant.gameEndedInEarlySurrender,
      kills: participant.kills,
      pentaKills: participant.pentaKills,
      quadraKills: participant.quadraKills,
      win: participant.win,
    },
    durationInSeconds,
  );
}
