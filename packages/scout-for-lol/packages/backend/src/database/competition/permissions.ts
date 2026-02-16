import { type DiscordAccountId, type DiscordGuildId, type PermissionType } from "@scout-for-lol/data";
import type { PermissionsBitField } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { type PrismaClient } from "@scout-for-lol/backend/generated/prisma/client/index.js";
import { checkRateLimit, getTimeRemaining } from "@scout-for-lol/backend/database/competition/rate-limit.ts";

// ============================================================================
// Permission Check Result
// ============================================================================

export type PermissionCheckResult = {
  allowed: boolean;
  reason?: string;
};

// ============================================================================
// Database Permission Functions
// ============================================================================

/**
 * Check if user has a specific permission in the database
 *
 * @param prisma - Prisma client instance
 * @param serverId - Discord server ID
 * @param userId - Discord user ID
 * @param permission - Permission type to check
 * @returns true if user has the permission
 */
export async function hasPermission(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  userId: DiscordAccountId,
  permission: PermissionType,
): Promise<boolean> {
  const record = await prisma.serverPermission.findUnique({
    where: {
      serverId_discordUserId_permission: {
        serverId,
        discordUserId: userId,
        permission,
      },
    },
  });

  return record !== null;
}

/**
 * Grant permission to a user
 */
export async function grantPermission(
  prisma: PrismaClient,
  params: {
    serverId: DiscordGuildId;
    userId: DiscordAccountId;
    permission: PermissionType;
    grantedBy: DiscordAccountId;
  },
): Promise<void> {
  const { serverId, userId, permission, grantedBy } = params;
  // Upsert to make this idempotent
  await prisma.serverPermission.upsert({
    where: {
      serverId_discordUserId_permission: {
        serverId,
        discordUserId: userId,
        permission,
      },
    },
    update: {
      // Update grantedBy and grantedAt if re-granting
      grantedBy,
      grantedAt: new Date(),
    },
    create: {
      serverId,
      discordUserId: userId,
      permission,
      grantedBy,
      grantedAt: new Date(),
    },
  });
}

/**
 * Revoke permission from a user
 *
 * @param prisma - Prisma client instance
 * @param serverId - Discord server ID
 * @param userId - Discord user ID
 * @param permission - Permission type to revoke
 */
export async function revokePermission(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  userId: DiscordAccountId,
  permission: PermissionType,
): Promise<void> {
  // Delete if exists - idempotent (no error if not found)
  await prisma.serverPermission.deleteMany({
    where: {
      serverId,
      discordUserId: userId,
      permission,
    },
  });
}

// ============================================================================
// Competition Creation Permission Check
// ============================================================================

/**
 * Check if user can create a competition
 *
 * This combines:
 * 1. Admin bypass (Discord ADMINISTRATOR permission)
 * 2. ServerPermission check (CREATE_COMPETITION grant)
 * 3. Rate limit check (1 per hour)
 *
 * @param prisma - Prisma client instance
 * @param serverId - Discord server ID
 * @param userId - Discord user ID
 * @param memberPermissions - Discord member permissions bit field
 * @returns Result with allowed flag and optional reason
 */
export async function canCreateCompetition(
  prisma: PrismaClient,
  serverId: DiscordGuildId,
  userId: DiscordAccountId,
  memberPermissions: Readonly<PermissionsBitField>,
): Promise<PermissionCheckResult> {
  // 1. Admin bypass - always allowed
  if (memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return { allowed: true };
  }

  // 2. Check ServerPermission grant
  const hasGrant = await hasPermission(prisma, serverId, userId, "CREATE_COMPETITION");

  if (!hasGrant) {
    return {
      allowed: false,
      reason: "Missing CREATE_COMPETITION permission. Ask a server admin to grant you permission.",
    };
  }

  // 3. Check rate limit
  if (!checkRateLimit(serverId, userId)) {
    const remainingMs = getTimeRemaining(serverId, userId);
    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));

    return {
      allowed: false,
      reason: `Rate limited: You can create 1 competition per hour. Try again in ${remainingMinutes.toString()} minute${remainingMinutes === 1 ? "" : "s"}.`,
    };
  }

  return { allowed: true };
}
