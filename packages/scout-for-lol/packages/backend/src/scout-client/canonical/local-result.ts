import { z } from "zod";
import {
  GameResultSchema,
  ParticipantIdentitySchema,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import { localMatchEndTimestamp } from "./lcu-match.ts";

const IdSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/u)])
  .transform(String);
const StatsSchema = z.looseObject({
  win: z.union([z.boolean(), z.enum(["Win", "Fail"])]),
  kills: z.number().int().nonnegative().nullish(),
  deaths: z.number().int().nonnegative().nullish(),
  assists: z.number().int().nonnegative().nullish(),
  goldEarned: z.number().int().nonnegative().nullish(),
  totalDamageDealtToChampions: z.number().int().nonnegative().nullish(),
  totalMinionsKilled: z.number().int().nonnegative().nullish(),
  champLevel: z.number().int().nonnegative().nullish(),
});
const HistorySchema = z.looseObject({
  gameId: IdSchema,
  platformId: z.string(),
  gameCreation: z.number().int().positive(),
  gameDuration: z.number().positive(),
  queueId: z.number().int().nonnegative(),
  gameMode: z.string(),
  gameType: z.string(),
  participants: z.array(
    z.looseObject({
      participantId: z.number().int().positive(),
      teamId: z.number().int().positive(),
      championId: z.number().int().nonnegative(),
      bot: z.boolean().optional(),
      stats: StatsSchema,
    }),
  ),
  participantIdentities: z.array(
    z.looseObject({
      participantId: z.number().int().positive(),
      player: z.looseObject({
        puuid: z.string().optional(),
        gameName: z.string().optional(),
        tagLine: z.string().optional(),
        summonerName: z.string().optional(),
      }),
    }),
  ),
});
const PayloadSchema = z.object({ resource: z.string(), data: z.unknown() });
const BundleSchema = z.object({ matchHistory: z.unknown() });
const TimingPresenceSchema = z.object({ timing: z.json() });

/** Share canonical timing validation; malformed witnessed clocks cannot become estimates. */
export function localResultCompletionTime(
  payload: unknown,
  result: GameResult,
): number | null {
  if (result.completedAt !== undefined) return result.completedAt;
  if (result.gameCreation === null) return null;
  const { data } = PayloadSchema.parse(payload);
  const witnessed = localMatchEndTimestamp(data);
  return witnessed === null && TimingPresenceSchema.safeParse(data).success
    ? null
    : (witnessed ?? result.gameCreation + result.durationSeconds * 1000);
}

/** Full terminal history can describe a result without EOG, pings or aliases for every opponent. */
export function parseLocalGameResult(
  matchId: RiotMatchId,
  payload: unknown,
  observer: string,
  sourceId: string,
): GameResult | null {
  const envelope = PayloadSchema.safeParse(payload);
  if (!envelope.success) return null;
  const bundle = BundleSchema.safeParse(envelope.data.data);
  const parsed = HistorySchema.safeParse(
    bundle.success ? bundle.data.matchHistory : envelope.data.data,
  );
  if (!parsed.success) return null;
  const game = parsed.data;
  if (
    envelope.data.resource !== "post_game" &&
    envelope.data.resource !== "post_game_timeline" &&
    envelope.data.resource !== `match_history_game:${game.gameId}`
  )
    return null;
  if (
    `${game.platformId.toUpperCase()}_${game.gameId}` !== matchId ||
    game.platformId.toUpperCase() !== platformRouteOf(matchId)
  )
    return null;
  const identities = new Map(
    game.participantIdentities.map((identity) => [
      identity.participantId,
      identity.player,
    ]),
  );
  if (
    identities.size !== game.participantIdentities.length ||
    !game.participantIdentities.some(
      (identity) =>
        identity.player.puuid === observer &&
        game.participants.some(
          (player) => player.participantId === identity.participantId,
        ),
    )
  )
    return null;
  const participants = game.participants.map((player) => {
    const identity = identities.get(player.participantId);
    const puuid = identity?.puuid;
    const riot = ParticipantIdentitySchema.safeParse({ kind: "riot", puuid });
    const local = ParticipantIdentitySchema.safeParse({
      kind: "local",
      uuid: puuid,
    });
    const stat = (name: string) => {
      const value = z.number().nonnegative().safeParse(player.stats[name]);
      return value.success ? value.data : null;
    };
    return {
      participantId: player.participantId,
      teamId: player.teamId,
      championId: player.championId,
      identity:
        puuid === "00000000-0000-0000-0000-000000000000" || player.bot === true
          ? { kind: "bot" }
          : riot.success
            ? riot.data
            : local.success
              ? local.data
              : { kind: "unresolved" },
      name:
        identity?.gameName === undefined
          ? (identity?.summonerName ?? null)
          : identity.tagLine === undefined
            ? identity.gameName
            : `${identity.gameName}#${identity.tagLine}`,
      win: player.stats.win === true || player.stats.win === "Win",
      kills: stat("kills"),
      deaths: stat("deaths"),
      assists: stat("assists"),
      gold: stat("goldEarned"),
      damageToChampions: stat("totalDamageDealtToChampions"),
      minions: stat("totalMinionsKilled"),
      level: stat("champLevel"),
    };
  });
  const result = GameResultSchema.safeParse({
    matchId,
    source: "SCOUT_CLIENT",
    sourceId,
    queueId: game.queueId,
    gameMode: game.gameMode,
    gameType: game.gameType,
    gameCreation: game.gameCreation,
    durationSeconds: game.gameDuration,
    participants,
  });
  return result.success ? result.data : null;
}
