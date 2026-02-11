import type { PlayerConfigEntry, RawMatch } from "@shepherdjerred/scout-data/index.ts";

/** Thresholds for determining exceptional games */
const EXCEPTIONAL_GAME_THRESHOLDS = {
  /** KDA ratio considered exceptionally good */
  highKda: 5,
  /** Minimum kills required for high KDA to count */
  minKillsForHighKda: 5,
  /** KDA ratio considered exceptionally bad */
  lowKda: 0.5,
  /** Minimum deaths required for low KDA to count (to filter out short/uneventful games) */
  minDeathsForLowKda: 5,
  /** Deaths considered exceptionally bad */
  manyDeaths: 10,
  /** Game duration in seconds for a fast game (20 min) */
  fastGameSeconds: 20 * 60,
  /** Game duration in seconds for a very long game (40 min) */
  longGameSeconds: 40 * 60,
  /** Minimum kill participation (kills + assists) for perfect game */
  minParticipationForPerfectGame: 5,
  /** KDA threshold for determining if player participated in a stomp */
  stompParticipationKda: 2,
};

export type ExceptionalGameResult = { isExceptional: false } | { isExceptional: true; reason: string };

/**
 * Calculate KDA ratio, treating 0 deaths as perfect (returns Infinity)
 */
function calculateKda(kills: number, deaths: number, assists: number): number {
  if (deaths === 0) {
    return Infinity;
  }
  return (kills + assists) / deaths;
}

type ParticipantStats = {
  kills: number;
  deaths: number;
  assists: number;
  pentaKills: number;
  quadraKills: number;
  win: boolean;
  gameEndedInEarlySurrender: boolean;
};

/**
 * Check for exceptionally good performance
 */
function checkExceptionallyGood(stats: ParticipantStats, kda: number): ExceptionalGameResult | undefined {
  const { kills, deaths, assists, pentaKills, quadraKills, win } = stats;

  if (pentaKills > 0) {
    return { isExceptional: true, reason: "pentakill" };
  }
  if (quadraKills > 0) {
    return { isExceptional: true, reason: "quadrakill" };
  }
  if (deaths === 0 && win && kills + assists >= EXCEPTIONAL_GAME_THRESHOLDS.minParticipationForPerfectGame) {
    return { isExceptional: true, reason: "perfect game (0 deaths with win)" };
  }
  if (kda >= EXCEPTIONAL_GAME_THRESHOLDS.highKda && kills >= EXCEPTIONAL_GAME_THRESHOLDS.minKillsForHighKda) {
    return { isExceptional: true, reason: `high KDA (${kda.toFixed(1)})` };
  }
  return undefined;
}

/**
 * Check for exceptionally bad performance
 */
function checkExceptionallyBad(stats: ParticipantStats, kda: number): ExceptionalGameResult | undefined {
  const { deaths, win, gameEndedInEarlySurrender } = stats;

  if (deaths >= EXCEPTIONAL_GAME_THRESHOLDS.manyDeaths) {
    return { isExceptional: true, reason: `many deaths (${deaths.toString()})` };
  }
  if (kda <= EXCEPTIONAL_GAME_THRESHOLDS.lowKda && deaths >= EXCEPTIONAL_GAME_THRESHOLDS.minDeathsForLowKda) {
    return { isExceptional: true, reason: `very bad KDA (${kda.toFixed(1)})` };
  }
  if (gameEndedInEarlySurrender && !win) {
    return { isExceptional: true, reason: "early surrender loss" };
  }
  return undefined;
}

/**
 * Check if game duration makes it exceptional (fast stomp or very long)
 */
function checkDurationExtremes(
  trackedParticipants: ParticipantStats[],
  durationInSeconds: number,
): ExceptionalGameResult | undefined {
  if (durationInSeconds < EXCEPTIONAL_GAME_THRESHOLDS.fastGameSeconds) {
    // Fast game - only exceptional if the tracked player actually participated in the stomp
    for (const participant of trackedParticipants) {
      const { kills, deaths, assists, win } = participant;
      const kda = calculateKda(kills, deaths, assists);
      // Good performance in a fast win (participated in stomp)
      if (win && kda >= EXCEPTIONAL_GAME_THRESHOLDS.stompParticipationKda) {
        return { isExceptional: true, reason: "fast win (stomp)" };
      }
      // Bad performance in a fast loss (got stomped)
      if (!win && kda < 1) {
        return { isExceptional: true, reason: "fast loss (stomped)" };
      }
    }
  }
  if (durationInSeconds > EXCEPTIONAL_GAME_THRESHOLDS.longGameSeconds) {
    return { isExceptional: true, reason: "very long game" };
  }
  return undefined;
}

/**
 * Check if a game is exceptional enough to warrant an AI review.
 * Looks for exceptionally good OR exceptionally bad performances.
 */
export function isExceptionalGame(
  matchData: RawMatch,
  playersInMatch: PlayerConfigEntry[],
  durationInSeconds: number,
): ExceptionalGameResult {
  // Get the tracked players' participant data from the raw match
  const trackedPuuids = new Set(playersInMatch.map((p) => p.league.leagueAccount.puuid));
  const trackedParticipants = matchData.info.participants
    .filter((p) => trackedPuuids.has(p.puuid))
    .map((p) => ({
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      pentaKills: p.pentaKills,
      quadraKills: p.quadraKills,
      win: p.win,
      gameEndedInEarlySurrender: p.gameEndedInEarlySurrender,
    }));

  if (trackedParticipants.length === 0) {
    return { isExceptional: false };
  }

  // Check each tracked player for exceptional performance
  for (const participant of trackedParticipants) {
    const kda = calculateKda(participant.kills, participant.deaths, participant.assists);

    const goodResult = checkExceptionallyGood(participant, kda);
    if (goodResult) {
      return goodResult;
    }

    const badResult = checkExceptionallyBad(participant, kda);
    if (badResult) {
      return badResult;
    }
  }

  // Check game duration extremes
  const durationResult = checkDurationExtremes(trackedParticipants, durationInSeconds);
  if (durationResult) {
    return durationResult;
  }

  return { isExceptional: false };
}
