import { type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  CompetitionCriteriaSchema,
  CompetitionGameVariantSchema,
  CompetitionVisibilitySchema,
  type DiscordAccountId,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  type DiscordGuildId,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { z } from "zod";

import { getLimit } from "#src/configuration/flags.ts";
import { activeOnlyWhere } from "#src/database/competition/queries.ts";
import { CompetitionDatesSchema } from "#src/database/competition/competition-dates.ts";
import { validateCompetitionConfiguration } from "#src/database/competition/configuration-validation.ts";

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a competition is considered "active"
 * Active means: not cancelled AND (not ended OR not started yet)
 */
export function isCompetitionActive(
  isCancelled: boolean,
  endDate: Date | null,
  now: Date = new Date(),
): boolean {
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
    title: z
      .string()
      .min(1, "Title cannot be empty")
      .max(100, "Title cannot exceed 100 characters")
      .trim(),
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
      .default(100),

    gameVariant: CompetitionGameVariantSchema.default("MODERN"),

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
        const objectResult = z
          .record(z.string(), z.unknown())
          .safeParse(config);
        if (!objectResult.success) {
          return false;
        }
        const criteria = { type: data.criteriaType, ...objectResult.data };
        const parsedCriteria = CompetitionCriteriaSchema.safeParse(criteria);
        if (!parsedCriteria.success) return false;
        validateCompetitionConfiguration(parsedCriteria.data, data.gameVariant);
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        "criteriaConfig must be valid JSON matching the criteriaType schema",
      path: ["criteriaConfig"],
    },
  );

export type CompetitionCreationInput = z.infer<
  typeof CompetitionCreationSchema
>;

// ============================================================================
// Database Validation Functions
// ============================================================================

/**
 * Validate owner doesn't have too many active competitions
 * This is async so it can't be part of Zod schema refinement easily
 */
export async function validateOwnerLimit(
  prisma: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  ownerId: DiscordAccountId,
): Promise<void> {
  // Get the limit for this owner/server combination
  const limit = getLimit("competitions_per_owner", {
    server: serverId,
    user: ownerId,
  });

  const now = new Date();

  // Count active competitions for this owner on this server
  const activeCompetitionCount = await prisma.competition.count({
    where: {
      serverId,
      ownerId,
      ...activeOnlyWhere(now),
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
  prisma: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  requesterId?: DiscordAccountId,
): Promise<void> {
  // Get the limit for this server and requester
  const attributes = requesterId
    ? { server: serverId, user: requesterId }
    : { server: serverId };
  const limit = getLimit("competitions_per_server", attributes);

  const now = new Date();

  // Count active competitions on this server
  const activeCompetitionCount = await prisma.competition.count({
    where: {
      serverId,
      ...activeOnlyWhere(now),
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
