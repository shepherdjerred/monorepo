import {
  GameResultSchema,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import {
  matchDataSourceOf,
  participantIdentityOf,
  type CanonicalMatch,
  type RawMatch,
} from "@scout-for-lol/data";

/**
 * Adapter from pinned raw bytes to the same result vocabulary used by LCU.
 * An end-of-game record maps as directly: a result states no participant
 * numbers or creation time either.
 */
export function gameResultFromMatch(match: CanonicalMatch): GameResult {
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

function gameResultDocument(match: CanonicalMatch) {
  return {
    matchId: match.metadata.matchId,
    source: matchDataSourceOf(match.metadata),
    sourceId: `canonical:${match.metadata.matchId}`,
    queueId: match.info.queueId,
    gameMode: match.info.gameMode,
    gameType: match.info.gameType,
    gameCreation: match.info.gameCreation,
    completedAt: match.info.gameEndTimestamp,
    durationSeconds: match.info.gameDuration,
    participants: match.info.participants.map((player) => ({
      participantId: player.participantId,
      teamId: player.teamId,
      identity: participantIdentityOf(player),
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
      items: [
        player.item0,
        player.item1,
        player.item2,
        player.item3,
        player.item4,
        player.item5,
        player.item6,
      ],
      spells: [player.summoner1Id, player.summoner2Id],
      jungleMinions: player.neutralMinionsKilled,
    })),
  };
}
