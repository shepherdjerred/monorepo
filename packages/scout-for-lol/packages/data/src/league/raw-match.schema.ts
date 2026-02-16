import { z } from "zod";
import { RawParticipantSchema } from "./raw-participant.schema.ts";
import { RawTeamSchema } from "./raw-team.schema.ts";

/**
 * Zod schema for RawMatch from the twisted library
 * Based on Riot Games Match V5 API
 *
 * This schema validates the structure of match data received from Riot API or read from S3.
 * While the data in S3 is trusted (we control what goes in), validation provides:
 * 1. Runtime type safety and early error detection
 * 2. Documentation of the expected structure
 * 3. Protection against API changes or data corruption
 */

/**
 * Raw Metadata - Contains match identification information
 */
export const RawMetadataSchema = z
  .object({
    dataVersion: z.string(),
    matchId: z.string(),
    participants: z.array(z.string()),
  })
  .strict();

/**
 * Raw Info - Contains the main match information
 */
export const RawInfoSchema = z
  .object({
    endOfGameResult: z.string(),
    gameCreation: z.number(),
    gameDuration: z.number(),
    gameEndTimestamp: z.number(),
    gameId: z.number(),
    gameMode: z.string(),
    gameModeMutators: z.array(z.string()).optional(),
    gameName: z.string(),
    gameStartTimestamp: z.number(),
    gameType: z.string(),
    gameVersion: z.string(),
    mapId: z.number(),
    participants: z.array(RawParticipantSchema),
    platformId: z.string(),
    queueId: z.number(),
    teams: z.array(RawTeamSchema),
    tournamentCode: z.string(),
  })
  .strict();

/**
 * Main RawMatch schema - represents a complete match from Riot Games Match V5 API
 */
export const RawMatchSchema = z
  .object({
    metadata: RawMetadataSchema,
    info: RawInfoSchema,
  })
  .strict();

export type RawMatch = z.infer<typeof RawMatchSchema>;
