import { z } from "zod";
import {
  CompetitionQueueTypeSchema,
  CompetitionVisibilitySchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  SeasonIdSchema,
} from "@shepherdjerred/scout-data";

/**
 * Shared date validation helper for fixed dates
 * Validates ISO 8601 formats including timezone information:
 * - YYYY-MM-DD (defaults to midnight local time)
 * - YYYY-MM-DDTHH:mm:ss (local time)
 * - YYYY-MM-DDTHH:mm:ssZ (UTC)
 * - YYYY-MM-DDTHH:mm:ss+HH:mm (with timezone offset)
 */
function createFixedDatesSchema() {
  return z
    .object({
      dateType: z.literal("FIXED"),
      startDate: z.string(),
      endDate: z.string(),
    })
    .refine(
      (data) => {
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        return !isNaN(start.getTime()) && !isNaN(end.getTime());
      },
      {
        message:
          "Invalid date format. Use ISO 8601 format (YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss, or with timezone Z/+HH:mm)",
        path: ["startDate"],
      },
    )
    .refine(
      (data) => {
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        return start < end;
      },
      {
        message: "Start date must be before end date",
        path: ["startDate"],
      },
    );
}

/**
 * Fixed dates schema for create command
 */
export const FixedDatesArgsSchema = createFixedDatesSchema();

/**
 * Fixed dates schema for edit command (same validation)
 */
export const FixedDatesEditArgsSchema = createFixedDatesSchema();

/**
 * Season variant using predefined season IDs
 */
export const SeasonArgsSchema = z.object({
  dateType: z.literal("SEASON"),
  season: SeasonIdSchema,
});

/**
 * Season schema for edit command.
 *
 * NOTE: This is intentionally a separate export (not just a re-export) even though the schema
 * is identical to SeasonArgsSchema. Having distinct "Create" and "Edit" schema names:
 * 1. Makes the codebase self-documenting - it's clear which context each schema is used in
 * 2. Allows future divergence if edit validation needs to differ from create validation
 * 3. Provides better error messages that reference the correct operation context
 *
 * knip flags this as a duplicate export, but the semantic separation is intentional.
 */
export const SeasonEditArgsSchema = SeasonArgsSchema;

/**
 * Common fields for all competition variants
 */
export const CommonArgsSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  channelId: DiscordChannelIdSchema,
  guildId: DiscordGuildIdSchema,
  userId: DiscordAccountIdSchema,
  visibility: CompetitionVisibilitySchema.optional(),
  maxParticipants: z.number().int().min(2).max(100).optional(),
  addAllMembers: z.boolean().optional(),
});

/**
 * Fields that can be edited at any time (even after competition starts)
 */
export const EditableAlwaysArgsSchema = z.object({
  competitionId: z.number().int().positive(),
  userId: DiscordAccountIdSchema,
  title: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  channelId: DiscordChannelIdSchema.optional(),
});

/**
 * Fields that can ONLY be edited before competition starts (DRAFT status)
 */
export const EditableDraftOnlyArgsSchema = z.object({
  visibility: CompetitionVisibilitySchema.optional(),
  maxParticipants: z.number().int().min(2).max(100).optional(),
});

/**
 * Criteria-specific schemas
 */
export const MostGamesPlayedArgsSchema = z.object({
  criteriaType: z.literal("MOST_GAMES_PLAYED"),
  queue: CompetitionQueueTypeSchema,
});

export const HighestRankArgsSchema = z.object({
  criteriaType: z.literal("HIGHEST_RANK"),
  queue: z.enum(["SOLO", "FLEX"]),
});

export const MostRankClimbArgsSchema = z.object({
  criteriaType: z.literal("MOST_RANK_CLIMB"),
  queue: z.enum(["SOLO", "FLEX"]),
});

export const MostWinsPlayerArgsSchema = z.object({
  criteriaType: z.literal("MOST_WINS_PLAYER"),
  queue: CompetitionQueueTypeSchema,
});

export const MostWinsChampionArgsSchema = z.object({
  criteriaType: z.literal("MOST_WINS_CHAMPION"),
  // Champion can be provided as string (from autocomplete with ID) or name
  // We'll convert it to championId during parsing
  champion: z.string().min(1),
  queue: CompetitionQueueTypeSchema.optional(),
});

export const HighestWinRateArgsSchema = z.object({
  criteriaType: z.literal("HIGHEST_WIN_RATE"),
  queue: CompetitionQueueTypeSchema,
  minGames: z.number().int().positive().optional(),
});

/**
 * Edit variants of criteria schemas.
 *
 * NOTE: These are intentionally separate exports even though the schemas are currently identical
 * to their "Create" counterparts. This pattern provides:
 * 1. Self-documenting code - clear which context each schema is used in
 * 2. Future flexibility - edit validation may need to differ (e.g., allowing partial updates)
 * 3. Consistent naming - all edit operations use "*EditArgsSchema" naming convention
 *
 * knip flags these as duplicate exports, but the semantic separation is intentional.
 */
export const MostGamesPlayedEditArgsSchema = MostGamesPlayedArgsSchema;
export const HighestRankEditArgsSchema = HighestRankArgsSchema;
export const MostRankClimbEditArgsSchema = MostRankClimbArgsSchema;
export const MostWinsPlayerEditArgsSchema = MostWinsPlayerArgsSchema;
export const MostWinsChampionEditArgsSchema = MostWinsChampionArgsSchema;
export const HighestWinRateEditArgsSchema = HighestWinRateArgsSchema;
