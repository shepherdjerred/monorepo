import { z } from "zod";
import { RawParticipantSchema } from "./raw-participant.schema.ts";
import { RawTeamSchema } from "./raw-team.schema.ts";

/**
 * Zod schema for Riot Match V5 responses
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
    endOfGameResult: z.string().optional(),
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
    tournamentCode: z.string().optional(),
  })
  .strict();

export type RawInfo = z.infer<typeof RawInfoSchema>;

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

/**
 * Fields Riot populates for a matchmade game but may omit for a custom one.
 *
 * They are `.optional()` on the schemas above so a tournament-code custom
 * parses at all. That relaxation must not reach matchmade games: a missing
 * `endOfGameResult` on a ranked match is a real problem and has to stay loud.
 * So the strictness moves here, applied by the caller against the payload's own
 * `gameType` rather than baked into the schema — see `missingExpectedMatchFields`.
 *
 * This is deliberately NOT a `superRefine` on `RawInfoSchema`. That schema is
 * parsed through `parseWithUnknownKeyFallback`, which recovers only when EVERY
 * issue is `unrecognized_keys`; mixing a refinement issue into it would make the
 * next additive Riot field fail the whole post-match pipeline closed.
 */
const EXPECTED_MATCH_FIELDS = ["endOfGameResult", "tournamentCode"] as const;

const EXPECTED_PARTICIPANT_FIELDS = [
  "eligibleForProgression",
  "missions",
  "summonerId",
  "summonerName",
] as const;

export function isCustomMatchPayload(match: RawMatch): boolean {
  return match.info.gameType.toUpperCase().startsWith("CUSTOM");
}

/**
 * Dotted paths of the expected-but-absent fields, empty when the payload is
 * complete. Pure; the caller decides whether absence is tolerable.
 */
export function missingExpectedMatchFields(match: RawMatch): string[] {
  const missing = EXPECTED_MATCH_FIELDS.filter(
    (field) => match.info[field] === undefined,
  ).map((field) => `info.${field}`);

  // Reported once per field rather than once per participant: ten identical
  // paths would bury the signal in both the log line and the S3 metadata.
  const missingOnAnyParticipant = EXPECTED_PARTICIPANT_FIELDS.filter((field) =>
    match.info.participants.some(
      (participant) => participant[field] === undefined,
    ),
  ).map((field) => `info.participants[].${field}`);

  return [...missing, ...missingOnAnyParticipant];
}
