import { z } from "zod";

/**
 * Zod schema for Riot Spectator V5 API responses
 * Based on Riot Games Spectator V5 API
 *
 * This schema validates the structure of active game data received from the Spectator API.
 * Used by pre-match detection to notify Discord when tracked players enter a game.
 *
 * Note: Uses .object() (not .strict()) to allow new fields Riot may add without breaking.
 */

/**
 * Banned champion in champion select
 */
export const RawBannedChampionSchema = z.object({
  championId: z.number(),
  teamId: z.number(),
  pickTurn: z.number(),
});

export type RawBannedChampion = z.infer<typeof RawBannedChampionSchema>;

/**
 * Participant in an active game
 */
export const RawCurrentGameParticipantSchema = z.object({
  championId: z.number(),
  /**
   * PUUID — can be null for certain participants (e.g., bots or privacy).
   *
   * When Riot scrubs a participant for privacy, this is `null` AND `riotId`
   * below is replaced with the champion display name (not a real Riot ID), so
   * the participant carries no usable identity and cannot be matched to a
   * tracked player in pre-match.
   */
  puuid: z.string().nullable(),
  teamId: z.number(),
  /**
   * Arena subteam ID (1-8). Only present in Spectator V5 responses for
   * Arena (CHERRY) games — undefined for all other queues.
   */
  playerSubteamId: z.number().optional(),
  /**
   * Riot ID (e.g., "Cain#3276"). Present in V5 API responses.
   *
   * NOTE: for privacy-scrubbed participants (where `puuid` is null), Riot
   * replaces this with the champion's display name (e.g. "Aatrox", no
   * `#tagLine`) — it is NOT the player's real Riot ID and must not be used to
   * identify them.
   */
  riotId: z.string(),
  /** Legacy summoner name — may not be present in V5 responses */
  summonerName: z.string().optional(),
  spell1Id: z.number(),
  spell2Id: z.number(),
  /** Selected skin number for the champion loading screen art */
  lastSelectedSkinIndex: z.number(),
  bot: z.boolean(),
  profileIconId: z.number(),
  /** Legacy summoner ID — may not be present in V5 responses */
  summonerId: z.string().optional(),
  gameCustomizationObjects: z
    .array(
      z.object({
        category: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  perks: z
    .object({
      perkIds: z.array(z.number()).optional(),
      perkStyle: z.number().optional(),
      perkSubStyle: z.number().optional(),
    })
    .optional(),
});

export type RawCurrentGameParticipant = z.infer<
  typeof RawCurrentGameParticipantSchema
>;

/**
 * Observer information for spectating
 */
const RawObserverSchema = z.object({
  encryptionKey: z.string(),
});

/**
 * RawCurrentGameInfo - Represents an active game from the Spectator V5 API
 */
export const RawCurrentGameInfoSchema = z.object({
  gameId: z.number(),
  gameStartTime: z.number(),
  gameMode: z.string(),
  mapId: z.number(),
  gameType: z.string(),
  gameQueueConfigId: z.number(),
  /** Elapsed game time in seconds. Negative while loading. */
  gameLength: z.number(),
  platformId: z.string(),
  participants: z.array(RawCurrentGameParticipantSchema),
  bannedChampions: z.array(RawBannedChampionSchema),
  observers: RawObserverSchema.optional(),
});

export type RawCurrentGameInfo = z.infer<typeof RawCurrentGameInfoSchema>;
