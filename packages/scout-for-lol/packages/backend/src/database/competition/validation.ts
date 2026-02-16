import { type PrismaClient } from "@scout-for-lol/backend/generated/prisma/client/index.js";
import {
  CompetitionCriteriaSchema,
  CompetitionVisibilitySchema,
  type DiscordAccountId,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  type DiscordGuildId,
  DiscordGuildIdSchema,
  SeasonIdSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import { differenceInCalendarDays } from "date-fns";

import { getLimit } from "@scout-for-lol/backend/configuration/flags.ts";

// ============================================================================
// Constants
// ============================================================================

const MAX_COMPETITION_DURATION_DAYS = 90;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a competition is considered "active"
 * Active means: not cancelled AND (not ended OR not started yet)
 */
export function isCompetitionActive(isCancelled: boolean, endDate: Date | null, now: Date = new Date()): boolean {
  if (isCancelled) {
    return false;
  }

  // Season-based competition (no endDate) is always active unless cancelled
  if (endDate === null) {
    return true;
  }

  // Fixed-date competition is active until endDate passes
  return endDate > now;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

/**
 * Fixed-date competition schema
 * Enforces date ordering and duration limits at the type level
 */
const FixedDateCompetitionSchema = z
  .object({
    type: z.literal("FIXED_DATES"),
    startDate: z.date(),
    endDate: z.date(),
  })
  .refine((data) => data.startDate < data.endDate, {
    message: "startDate must be before endDate",
    path: ["startDate"],
  })
  .superRefine((data, ctx) => {
    const durationDays = differenceInCalendarDays(data.endDate, data.startDate);
    if (durationDays > MAX_COMPETITION_DURATION_DAYS) {
      ctx.addIssue({
        code: "custom",
        message: `Competition duration cannot exceed ${MAX_COMPETITION_DURATION_DAYS.toString()} days (got ${durationDays.toString()} days)`,
        path: ["endDate"],
      });
    }
  });

/**
 * Season-based competition schema
 * No date constraints - follows League's season timing
 * Uses predefined season IDs only
 */
const SeasonBasedCompetitionSchema = z.object({
  type: z.literal("SEASON"),
  seasonId: SeasonIdSchema,
});

/**
 * Discriminated union for competition dates
 * Type system enforces XOR constraint - can't have both fixed dates AND season
 */
export const CompetitionDatesSchema = z.discriminatedUnion("type", [
  FixedDateCompetitionSchema,
  SeasonBasedCompetitionSchema,
]);

export type CompetitionDates = z.infer<typeof CompetitionDatesSchema>;

/**
 * Schema for competition creation input with comprehensive validation
 */
export const CompetitionCreationSchema = z
  .object({
    // Identity fields (Discord snowflakes - 17-19 digits)
    // Use branded schemas which validate AND transform to branded types
    serverId: DiscordGuildIdSchema,
    ownerId: DiscordAccountIdSchema,
    channelId: DiscordChannelIdSchema,

    // Content fields
    title: z.string().min(1, "Title cannot be empty").max(100, "Title cannot exceed 100 characters").trim(),
    description: z
      .string()
      .min(1, "Description cannot be empty")
      .max(500, "Description cannot exceed 500 characters")
      .trim(),

    // Configuration
    visibility: CompetitionVisibilitySchema,
    maxParticipants: z
      .number()
      .int("Max participants must be an integer")
      .min(2, "Competition must allow at least 2 participants")
      .max(100, "Competition cannot exceed 100 participants")
      .default(50),

    // Dates (discriminated union enforces XOR)
    dates: CompetitionDatesSchema,

    // Criteria (type + config as JSON string)
    criteriaType: z.string().min(1),
    criteriaConfig: z.string().min(1), // JSON string
  })
  .refine(
    (data) => {
      // Validate criteriaConfig is valid JSON and matches criteriaType schema
      try {
        const config: unknown = JSON.parse(data.criteriaConfig);
        const objectResult = z.record(z.string(), z.unknown()).safeParse(config);
        if (!objectResult.success) {
          return false;
        }
        const criteria = { type: data.criteriaType, ...objectResult.data };
        return CompetitionCriteriaSchema.safeParse(criteria).success;
      } catch {
        return false;
      }
    },
    {
      message: "criteriaConfig must be valid JSON matching the criteriaType schema",
      path: ["criteriaConfig"],
    },
  );

export type CompetitionCreationInput = z.infer<typeof CompetitionCreationSchema>;

// ============================================================================
// Database Validation Functions
// ============================================================================

/**
 * Validate owner doesn't have too many active competitions
 * This is async so it can't be part of Zod schema refinement easily
 */
export async function validateOwnerLimit(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  ownerId: DiscordAccountId,
): Promise<void> {
  // Get the limit for this owner/server combination
  const limit = getLimit("competitions_per_owner", { server: serverId, user: ownerId });

  const now = new Date();

  // Count active competitions for this owner on this server
  const activeCompetitionCount = await prisma.competition.count({
    where: {
      serverId,
      ownerId,
      isCancelled: false,
      OR: [
        // Season-based competitions (no endDate)
        { endDate: null },
        // Fixed-date competitions that haven't ended yet
        { endDate: { gt: now } },
      ],
    },
  });

  if (limit === "unlimited") {
    // noop
  } else if (activeCompetitionCount >= limit) {
    throw new Error(
      `You already have ${activeCompetitionCount.toString()} active competition(s). Please end or cancel your existing competition before creating a new one.`,
    );
  }
}

/**
 * Validate server doesn't have too many active competitions
 */
export async function validateServerLimit(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  requesterId?: DiscordAccountId,
): Promise<void> {
  // Get the limit for this server and requester
  const attributes = requesterId ? { server: serverId, user: requesterId } : { server: serverId };
  const limit = getLimit("competitions_per_server", attributes);

  const now = new Date();

  // Count active competitions on this server
  const activeCompetitionCount = await prisma.competition.count({
    where: {
      serverId,
      isCancelled: false,
      OR: [
        // Season-based competitions (no endDate)
        { endDate: null },
        // Fixed-date competitions that haven't ended yet
        { endDate: { gt: now } },
      ],
    },
  });

  if (limit === "unlimited") {
    // noop
  } else if (activeCompetitionCount >= limit) {
    throw new Error(
      `This server already has ${activeCompetitionCount.toString()} active competitions. Maximum allowed is ${limit.toString()}.`,
    );
  }
}
