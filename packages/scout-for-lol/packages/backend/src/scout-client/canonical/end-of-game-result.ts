import { z } from "zod";
import {
  GameResultSchema,
  ParticipantIdentitySchema,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

const IdSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform(String);
const StatSchema = z.number().int().nonnegative();
const PlayerSchema = z.looseObject({
  puuid: z.string().min(1),
  gameId: IdSchema,
  teamId: z.number().int().positive(),
  championId: z.number().int().positive(),
  botPlayer: z.boolean(),
  riotIdGameName: z.string(),
  riotIdTagLine: z.string(),
  items: z.array(StatSchema).length(7),
  spell1Id: StatSchema,
  spell2Id: StatSchema,
  stats: z.looseObject({
    WIN: z.union([z.literal(0), z.literal(1)]),
    kills: StatSchema,
    deaths: StatSchema,
    assists: StatSchema,
    goldEarned: StatSchema,
    totalDamageDealtToChampions: StatSchema,
    totalMinionsKilled: StatSchema,
    neutralMinionsKilled: StatSchema,
    champLevel: StatSchema,
  }),
});
export const EndOfGameResultSchema = z.looseObject({
  invalid: z.literal(false).optional(),
  gameId: IdSchema,
  gameMode: z.string().min(1),
  gameType: z.string().min(1),
  queueType: z.string().min(1),
  gameLength: z.number().positive().max(86_400),
  endOfGameTimestamp: z.number().int().positive(),
  teams: z
    .array(
      z.looseObject({
        teamId: z.number().int().positive(),
        isWinningTeam: z.boolean(),
        players: z.array(PlayerSchema).min(1),
      }),
    )
    .min(2),
});
const QueueContextSchema = z.object({
  gameData: z.object({
    gameId: IdSchema,
    queue: z.object({
      id: z.number().int().nonnegative(),
      type: z.string(),
      gameMode: z.string(),
    }),
  }),
});

/** A terminal scoreboard states results without claiming absent Match-V5 fields. */
export function parseEndOfGameResult(input: {
  matchId: RiotMatchId;
  payload: unknown;
  context: unknown;
  observer: string;
  sourceId: string;
}): GameResult | null {
  const envelope = z
    .object({ resource: z.literal("post_game"), data: EndOfGameResultSchema })
    .safeParse(input.payload);
  const context = QueueContextSchema.safeParse(input.context);
  if (!envelope.success || !context.success) return null;
  const game = envelope.data.data;
  const queue = context.data.gameData.queue;
  if (
    !input.matchId.endsWith(`_${game.gameId}`) ||
    context.data.gameData.gameId !== game.gameId ||
    queue.type !== game.queueType ||
    queue.gameMode !== game.gameMode
  )
    return null;
  const players = game.teams.flatMap((team) => team.players);
  if (
    !players.some((player) => player.puuid === input.observer) ||
    new Set(players.map((player) => player.puuid)).size !== players.length ||
    new Set(game.teams.map((team) => team.teamId)).size !== game.teams.length
  )
    return null;
  if (
    game.teams.some((team) =>
      team.players.some(
        (player) =>
          player.gameId !== game.gameId ||
          player.teamId !== team.teamId ||
          (player.stats.WIN === 1) !== team.isWinningTeam,
      ),
    )
  )
    return null;
  const result = GameResultSchema.safeParse({
    matchId: input.matchId,
    source: "SCOUT_CLIENT",
    sourceId: input.sourceId,
    queueId: queue.id,
    gameMode: game.gameMode,
    gameType: game.gameType,
    gameCreation: null,
    completedAt: game.endOfGameTimestamp,
    durationSeconds: game.gameLength,
    participants: game.teams.flatMap((team) =>
      team.players.map((player) => {
        const riot = ParticipantIdentitySchema.safeParse({
          kind: "riot",
          puuid: player.puuid,
        });
        const local = ParticipantIdentitySchema.safeParse({
          kind: "local",
          uuid: player.puuid,
        });
        return {
          participantId: null,
          teamId: team.teamId,
          championId: player.championId,
          identity: player.botPlayer
            ? { kind: "bot" }
            : riot.success
              ? riot.data
              : local.success
                ? local.data
                : { kind: "unresolved" },
          name: `${player.riotIdGameName}#${player.riotIdTagLine}`,
          win: team.isWinningTeam,
          kills: player.stats.kills,
          deaths: player.stats.deaths,
          assists: player.stats.assists,
          gold: player.stats.goldEarned,
          damageToChampions: player.stats.totalDamageDealtToChampions,
          minions: player.stats.totalMinionsKilled,
          jungleMinions: player.stats.neutralMinionsKilled,
          level: player.stats.champLevel,
          items: player.items,
          spells: [player.spell1Id, player.spell2Id],
        };
      }),
    ),
  });
  return result.success ? result.data : null;
}
