import { prisma } from "../index.js";
import { loggers } from "../../utils/logger.js";

const logger = loggers.database.child("activity");

export type RecordMessageActivityInput = {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;
  characterCount?: number;
};

export type RecordReactionActivityInput = {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;
  emoji: string;
};

export type ActivityStats = {
  messageCount: number;
  reactionCount: number;
  totalActivity: number;
  rank: number;
};

export type TopUser = {
  userId: string;
  activityCount: number;
  rank: number;
};

/**
 * Record a message activity (fire-and-forget pattern)
 */
export function recordMessageActivity(input: RecordMessageActivityInput): void {
  void prisma.userActivity
    .create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        channelId: input.channelId,
        activityType: "message",
        metadata: input.characterCount != null
          ? JSON.stringify({
              messageId: input.messageId,
              characterCount: input.characterCount,
            })
          : JSON.stringify({ messageId: input.messageId }),
      },
    })
    .catch((error: unknown) => {
      logger.error("Failed to record message activity", error, {
        guildId: input.guildId,
        userId: input.userId,
      });
    });
}

/**
 * Record a reaction activity (fire-and-forget pattern)
 */
export function recordReactionActivity(
  input: RecordReactionActivityInput,
): void {
  void prisma.userActivity
    .create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        channelId: input.channelId,
        activityType: "reaction",
        metadata: JSON.stringify({
          messageId: input.messageId,
          emoji: input.emoji,
        }),
      },
    })
    .catch((error: unknown) => {
      logger.error("Failed to record reaction activity", error, {
        guildId: input.guildId,
        userId: input.userId,
      });
    });
}

/**
 * Get activity statistics for a specific user
 */
export async function getUserActivityStats(
  guildId: string,
  userId: string,
  dateRange?: { start: Date; end: Date },
): Promise<ActivityStats> {
  const where = {
    guildId,
    userId,
    ...(dateRange != null && {
      createdAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
    }),
  };

  const [messageCount, reactionCount] = await Promise.all([
    // Count messages
    prisma.userActivity.count({
      where: { ...where, activityType: "message" },
    }),
    // Count reactions
    prisma.userActivity.count({
      where: { ...where, activityType: "reaction" },
    }),
  ]);

  const totalActivity = messageCount + reactionCount;

  // Calculate rank: count how many users have higher total activity
  const higherActivityCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(DISTINCT userId) as count
    FROM (
      SELECT userId, COUNT(*) as activityCount
      FROM UserActivity
      WHERE guildId = ${guildId}
        ${dateRange != null ? `AND createdAt >= ${dateRange.start.toISOString()} AND createdAt <= ${dateRange.end.toISOString()}` : ""}
      GROUP BY userId
      HAVING activityCount > ${totalActivity}
    )
  `;

  const rank = (higherActivityCount[0]?.count ?? 0) + 1;

  return {
    messageCount,
    reactionCount,
    totalActivity,
    rank,
  };
}

/**
 * Get top active users in a guild
 */
export async function getTopActiveUsers(
  guildId: string,
  options?: {
    limit?: number;
    activityType?: "message" | "reaction" | "all";
    dateRange?: { start: Date; end: Date };
  },
): Promise<TopUser[]> {
  const limit = options?.limit ?? 10;
  const activityType = options?.activityType ?? "all";

  const where = {
    guildId,
    ...(activityType !== "all" && { activityType }),
    ...(options?.dateRange != null && {
      createdAt: {
        gte: options.dateRange.start,
        lte: options.dateRange.end,
      },
    }),
  };

  const activities = await prisma.userActivity.groupBy({
    by: ["userId"],
    where,
    _count: {
      id: true,
    },
    orderBy: {
      _count: {
        id: "desc",
      },
    },
    take: limit,
  });

  return activities.map((activity, index) => ({
    userId: activity.userId,
    activityCount: activity._count.id,
    rank: index + 1,
  }));
}
