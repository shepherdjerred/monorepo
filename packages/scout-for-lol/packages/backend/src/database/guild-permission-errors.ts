import {
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "@scout-for-lol/backend/database/index.ts";
import { subDays } from "date-fns";

/**
 * Record a permission error for a guild/channel
 * Updates existing record or creates new one
 */
export async function recordPermissionError(
  prisma: ExtendedPrismaClient,
  params: {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
    errorType: string;
    errorReason?: string;
  },
): Promise<void> {
  const { serverId, channelId, errorType, errorReason } = params;
  const now = new Date();

  // Try to find existing error record
  const existing = await prisma.guildPermissionError.findUnique({
    where: {
      serverId_channelId: {
        serverId,
        channelId,
      },
    },
  });

  await (existing
    ? prisma.guildPermissionError.update({
        where: {
          serverId_channelId: {
            serverId,
            channelId,
          },
        },
        data: {
          lastOccurrence: now,
          consecutiveErrorCount: existing.consecutiveErrorCount + 1,
          errorType,
          errorReason: errorReason ?? existing.errorReason,
        },
      })
    : prisma.guildPermissionError.create({
        data: {
          serverId,
          channelId,
          errorType,
          errorReason: errorReason ?? null,
          firstOccurrence: now,
          lastOccurrence: now,
          consecutiveErrorCount: 1,
        },
      }));
}

/**
 * Record a successful message send - resets error count
 */
export async function recordSuccessfulSend(
  prisma: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  channelId: DiscordChannelId,
): Promise<void> {
  const now = new Date();

  // Check if there's an existing error record
  const existing = await prisma.guildPermissionError.findUnique({
    where: {
      serverId_channelId: {
        serverId,
        channelId,
      },
    },
  });

  await (existing
    ? prisma.guildPermissionError.update({
        where: {
          serverId_channelId: {
            serverId,
            channelId,
          },
        },
        data: {
          consecutiveErrorCount: 0,
          lastSuccessfulSend: now,
        },
      })
    : prisma.guildPermissionError.create({
        data: {
          serverId,
          channelId,
          errorType: "none",
          firstOccurrence: now,
          lastOccurrence: now,
          consecutiveErrorCount: 0,
          lastSuccessfulSend: now,
        },
      }));
}

/**
 * Get guilds that have had consecutive permission errors for more than a specified duration
 * Only returns guilds where ALL channels have errors and there are NO working channels
 * @param minDays - Minimum number of days of consecutive errors (default: 7)
 * @returns List of abandoned guilds
 */
export async function getAbandonedGuilds(
  prisma: ExtendedPrismaClient,
  minDays = 7,
): Promise<
  {
    serverId: DiscordGuildId;
    firstOccurrence: Date;
    lastOccurrence: Date;
    errorCount: number;
  }[]
> {
  const cutoffDate = subDays(new Date(), minDays);

  const errors = await prisma.guildPermissionError.findMany({
    where: {
      // Has errors
      consecutiveErrorCount: {
        gt: 0,
      },
      // First error was more than minDays ago
      firstOccurrence: {
        lte: cutoffDate,
      },
      // Has NOT been successfully sent to recently (or never)
      OR: [
        {
          lastSuccessfulSend: null,
        },
        {
          lastSuccessfulSend: {
            lte: cutoffDate,
          },
        },
      ],
      // Owner hasn't been notified about abandonment yet
      ownerNotified: false,
    },
  });

  // Group by serverId and aggregate
  const guilds: Record<
    string,
    {
      serverId: DiscordGuildId;
      firstOccurrence: Date;
      lastOccurrence: Date;
      errorCount: number;
    }
  > = {};

  for (const error of errors) {
    const existing = guilds[error.serverId];
    if (existing) {
      // Update with earliest first occurrence and latest last occurrence
      if (error.firstOccurrence < existing.firstOccurrence) {
        existing.firstOccurrence = error.firstOccurrence;
      }
      if (error.lastOccurrence > existing.lastOccurrence) {
        existing.lastOccurrence = error.lastOccurrence;
      }
      existing.errorCount += error.consecutiveErrorCount;
    } else {
      guilds[error.serverId] = {
        serverId: error.serverId,
        firstOccurrence: error.firstOccurrence,
        lastOccurrence: error.lastOccurrence,
        errorCount: error.consecutiveErrorCount,
      };
    }
  }

  // Filter out guilds that have any working channels
  // Only abandon if ALL channels have errors
  const abandonedGuilds: typeof guilds = {};

  for (const [serverId, guildInfo] of Object.entries(guilds)) {
    // Check if this guild has ANY channels with recent successful sends
    const workingChannels = await prisma.guildPermissionError.findFirst({
      where: {
        serverId: guildInfo.serverId,
        consecutiveErrorCount: 0,
        lastSuccessfulSend: {
          gte: cutoffDate,
        },
      },
    });

    // Only include guild if it has NO working channels
    if (!workingChannels) {
      abandonedGuilds[serverId] = guildInfo;
    }
  }

  return Object.values(abandonedGuilds);
}

/**
 * Mark a guild as having been notified about abandonment
 */
export async function markGuildAsNotified(
  prisma: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<void> {
  await prisma.guildPermissionError.updateMany({
    where: {
      serverId,
    },
    data: {
      ownerNotified: true,
    },
  });
}

/**
 * Clean up old error records (optional maintenance)
 * Removes records that have been successfully resolved for more than 30 days
 */
export async function cleanupOldErrorRecords(
  prisma: ExtendedPrismaClient,
): Promise<number> {
  const cutoffDate = subDays(new Date(), 30);

  const result = await prisma.guildPermissionError.deleteMany({
    where: {
      consecutiveErrorCount: 0,
      lastSuccessfulSend: {
        lte: cutoffDate,
      },
    },
  });

  return result.count;
}
