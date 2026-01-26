import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";
import {
  recordMessageActivity,
  recordReactionActivity,
  getUserActivityStats,
  getTopActiveUsers
} from "../../../database/repositories/activity.js";
import { getDiscordClient } from "../../../discord/index.js";

const logger = loggers.tools.child("discord.activity");

export const recordActivityTool = createTool({
  id: "record-activity",
  description: "Record user activity (message or reaction) for tracking and leaderboards",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    type: z.enum(["message", "reaction"]).describe("The type of activity to record"),
    channelId: z.string().describe("The ID of the channel"),
    userId: z.string().describe("The ID of the user"),
    messageId: z.string().describe("The ID of the message"),
    characterCount: z.number().optional().describe("Length of message content (for message type)"),
    emoji: z.string().optional().describe("The emoji used (required for reaction type)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    return withToolSpan("record-activity", ctx.guildId, async () => {
      logger.debug("Recording activity", { guildId: ctx.guildId, userId: ctx.userId, type: ctx.type });
      try {
        switch (ctx.type) {
          case "message": {
            const activityInput: Parameters<typeof recordMessageActivity>[0] = {
              guildId: ctx.guildId,
              userId: ctx.userId,
              channelId: ctx.channelId,
              messageId: ctx.messageId,
            };
            if (ctx.characterCount !== undefined) {
              activityInput.characterCount = ctx.characterCount;
            }
            recordMessageActivity(activityInput);
            await Promise.resolve();
            return {
              success: true,
              message: "Message activity recorded successfully",
            };
          }

          case "reaction": {
            if (!ctx.emoji) {
              return {
                success: false,
                message: "emoji is required for reaction activity",
              };
            }
            recordReactionActivity({
              guildId: ctx.guildId,
              userId: ctx.userId,
              channelId: ctx.channelId,
              messageId: ctx.messageId,
              emoji: ctx.emoji,
            });
            await Promise.resolve();
            return {
              success: true,
              message: "Reaction activity recorded successfully",
            };
          }
        }
      } catch (error) {
        logger.error("Failed to record activity", error, { guildId: ctx.guildId, userId: ctx.userId });
        captureException(error as Error, { operation: "tool.record-activity" });
        return {
          success: false,
          message: `Failed to record activity: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const getActivityStatsTool = createTool({
  id: "get-activity-stats",
  description: "Get activity statistics: user stats or top active users leaderboard",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["user", "leaderboard"]).describe("Get stats for a user or get leaderboard"),
    userId: z.string().optional().describe("The user ID (required for user action)"),
    startDate: z.string().optional().describe("Start date for activity range (ISO format)"),
    endDate: z.string().optional().describe("End date for activity range (ISO format)"),
    activityType: z.enum(["message", "reaction", "voice", "all"]).optional()
      .describe("Type of activity to rank by (for leaderboard, default: all)"),
    limit: z.number().min(1).max(100).optional().describe("Number of users to return (for leaderboard, default: 10)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.union([
      z.object({
        userId: z.string(),
        messageCount: z.number(),
        reactionCount: z.number(),
        voiceCount: z.number(),
        totalActivity: z.number(),
        rank: z.number(),
      }),
      z.object({
        users: z.array(z.object({
          userId: z.string(),
          username: z.string(),
          activityCount: z.number(),
          rank: z.number(),
        })),
      }),
    ]).optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("get-activity-stats", ctx.guildId, async () => {
      try {
        const dateRange = ctx.startDate && ctx.endDate ? {
          start: new Date(ctx.startDate),
          end: new Date(ctx.endDate),
        } : undefined;

        switch (ctx.action) {
          case "user": {
            if (!ctx.userId) {
              return {
                success: false,
                message: "userId is required for user stats",
              };
            }
            const stats = await getUserActivityStats(ctx.guildId, ctx.userId, dateRange);
            logger.info("User activity stats retrieved", { guildId: ctx.guildId, userId: ctx.userId });
            return {
              success: true,
              message: `User has ${stats.totalActivity.toString()} total activity points (rank #${stats.rank.toString()})`,
              data: {
                userId: ctx.userId,
                ...stats,
              },
            };
          }

          case "leaderboard": {
            const topUsersOptions: Parameters<typeof getTopActiveUsers>[1] = {
              limit: ctx.limit ?? 10,
              activityType: ctx.activityType ?? "all",
            };
            if (dateRange !== undefined) {
              topUsersOptions.dateRange = dateRange;
            }
            const topUsers = await getTopActiveUsers(ctx.guildId, topUsersOptions);

            // Fetch usernames from Discord
            const client = getDiscordClient();
            const guild = await client.guilds.fetch(ctx.guildId);
            const usersWithNames = await Promise.all(
              topUsers.map(async (user) => {
                try {
                  const member = await guild.members.fetch(user.userId);
                  return {
                    userId: user.userId,
                    username: member.user.username,
                    activityCount: user.activityCount,
                    rank: user.rank,
                  };
                } catch (_error) {
                  logger.warn("Could not fetch username for user", { userId: user.userId });
                  return {
                    userId: user.userId,
                    username: "Unknown User",
                    activityCount: user.activityCount,
                    rank: user.rank,
                  };
                }
              })
            );
            logger.info("Top active users retrieved", { guildId: ctx.guildId, count: usersWithNames.length });
            return {
              success: true,
              message: `Retrieved top ${usersWithNames.length.toString()} active users`,
              data: { users: usersWithNames },
            };
          }
        }
      } catch (error) {
        logger.error("Failed to get activity stats", error, { guildId: ctx.guildId });
        captureException(error as Error, { operation: "tool.get-activity-stats" });
        return {
          success: false,
          message: `Failed to get activity stats: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const activityTools = [recordActivityTool, getActivityStatsTool];
