import { z } from "zod";

/**
 * Zod schema for Spectator V5 API responses from the twisted library
 * Based on Riot Games Spectator V5 API
 *
 * This schema validates the structure of active game data received from the Spectator API.
 * Used by pre-match detection to notify Discord when tracked players enter a game.
 */

/**
 * Banned champion in champion select
 */
export const RawBannedChampionSchema = z
  .object({
    championId: z.number(),
    teamId: z.number(),
    pickTurn: z.number(),
  })
  .strict();

export type RawBannedChampion = z.infer<typeof RawBannedChampionSchema>;

/**
 * Participant in an active game
 */
export const RawCurrentGameParticipantSchema = z
  .object({
    championId: z.number(),
    puuid: z.string(),
    teamId: z.number(),
    summonerName: z.string(),
    spell1Id: z.number(),
    spell2Id: z.number(),
    bot: z.boolean(),
    profileIconId: z.number(),
    summonerId: z.string(),
    gameCustomizationObjects: z
      .array(
        z
          .object({
            category: z.string(),
            content: z.string(),
          })
          .strict(),
      )
      .optional(),
    perks: z
      .object({
        perkIds: z.array(z.number()).optional(),
        perkStyle: z.number().optional(),
        perkSubStyle: z.number().optional(),
      })
      .optional(),
    riotId: z.string().optional(),
    lastSelectedSkinIndex: z.number().optional(),
  })
  .strict();

export type RawCurrentGameParticipant = z.infer<
  typeof RawCurrentGameParticipantSchema
>;

/**
 * Observer information for spectating
 */
const RawObserverSchema = z
  .object({
    encryptionKey: z.string(),
  })
  .strict();

/**
 * RawCurrentGameInfo - Represents an active game from the Spectator V5 API
 */
export const RawCurrentGameInfoSchema = z
  .object({
    gameId: z.number(),
    gameStartTime: z.number(),
    gameMode: z.string(),
    mapId: z.number(),
    gameType: z.string(),
    gameQueueConfigId: z.number(),
    gameLength: z.number(),
    platformId: z.string(),
    participants: z.array(RawCurrentGameParticipantSchema),
    bannedChampions: z.array(RawBannedChampionSchema),
    observers: RawObserverSchema.optional(),
  })
  .strict();

export type RawCurrentGameInfo = z.infer<typeof RawCurrentGameInfoSchema>;
