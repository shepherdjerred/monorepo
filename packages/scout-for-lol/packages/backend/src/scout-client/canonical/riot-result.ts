import {
  GameResultSchema,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import { SCOUT_CLIENT_DATA_VERSION, type RawMatch } from "@scout-for-lol/data";

/** Adapter from pinned raw bytes to the same result vocabulary used by LCU. */
export function gameResultFromMatch(match: RawMatch): GameResult {
  return GameResultSchema.parse(gameResultDocument(match));
}

/** Raw upstream captures can describe cancelled/unsupported games rather than results. */
export function parseResultFromMatch(
  match: RawMatch,
  sourceId: string,
): GameResult | null {
  const parsed = GameResultSchema.safeParse({
    ...gameResultDocument(match),
    source: "RIOT",
    sourceId,
  });
  return parsed.success ? parsed.data : null;
}

function gameResultDocument(match: RawMatch) {
  return {
    matchId: match.metadata.matchId,
    source:
      match.metadata.dataVersion === SCOUT_CLIENT_DATA_VERSION
        ? "SCOUT_CLIENT"
        : "RIOT",
    sourceId: `canonical:${match.metadata.matchId}`,
    queueId: match.info.queueId,
    gameMode: match.info.gameMode,
    gameType: match.info.gameType,
    gameCreation: match.info.gameCreation,
    durationSeconds: match.info.gameDuration,
    participants: match.info.participants.map((player) => ({
      participantId: player.participantId,
      teamId: player.teamId,
      identity:
        player.puuid.length === 78
          ? { kind: "riot", puuid: player.puuid }
          : { kind: "unresolved" },
      championId: player.championId,
      name:
        player.riotIdGameName === undefined
          ? (player.summonerName ?? null)
          : `${player.riotIdGameName}#${player.riotIdTagline}`,
      win: player.win,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      gold: player.goldEarned,
      damageToChampions: player.totalDamageDealtToChampions,
      minions: player.totalMinionsKilled,
      level: player.champLevel,
    })),
  };
}
