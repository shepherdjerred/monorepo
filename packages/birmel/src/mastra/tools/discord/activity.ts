import { createTool } from "@mastra/core/tools";
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

export const recordMessageActivityTool = createTool({
  id: "record-message-activity",
  description: "Record a message sent by a user for activity tracking and leaderboards",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    channelId: z.string().describe("The ID of the channel"),
    userId: z.string().describe("The ID of the user who sent the message"),
    messageId: z.string().describe("The ID of the message"),
    characterCount: z.number().optional().describe("Length of the message content")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input) => {
    const { guildId, userId, channelId, messageId, characterCount } = input;
    return withToolSpan("record-message-activity", guildId, async () => {
      logger.debug("Recording message activity", {
        guildId,
        userId
      });
      try {
        const activityInput: Parameters<typeof recordMessageActivity>[0] = {
          guildId,
          userId,
          channelId,
          messageId,
        };
        if (characterCount !== undefined) {
          activityInput.characterCount = characterCount;
        }
        recordMessageActivity(activityInput);

        return await Promise.resolve({
          success: true,
          message: "Message activity recorded successfully"
        });
      } catch (error) {
        logger.error("Failed to record message activity", error, {
          guildId,
          userId
        });
        captureException(error as Error, {
          operation: "tool.record-message-activity",
          discord: { guildId, userId }
        });
        return {
          success: false,
          message: `Failed to record activity: ${(error as Error).message}`
        };
      }
    });
  }
});

export const recordReactionActivityTool = createTool({
  id: "record-reaction-activity",
  description: "Record a reaction added by a user for activity tracking",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    channelId: z.string().describe("The ID of the channel"),
    messageId: z.string().describe("The ID of the message that was reacted to"),
    userId: z.string().describe("The ID of the user who added the reaction"),
    emoji: z.string().describe("The emoji that was used (Unicode or custom emoji ID)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input) => {
    const { guildId, userId, channelId, messageId, emoji } = input;
    return withToolSpan("record-reaction-activity", guildId, async () => {
      logger.debug("Recording reaction activity", {
        guildId,
        userId,
        emoji
      });
      try {
        recordReactionActivity({
          guildId,
          userId,
          channelId,
          messageId,
          emoji
        });

        return await Promise.resolve({
          success: true,
          message: "Reaction activity recorded successfully"
        });
      } catch (error) {
        logger.error("Failed to record reaction activity", error, {
          guildId,
          userId
        });
        captureException(error as Error, {
          operation: "tool.record-reaction-activity",
          discord: { guildId, userId }
        });
        return {
          success: false,
          message: `Failed to record reaction: ${(error as Error).message}`
        };
      }
    });
  }
});

export const getUserActivityTool = createTool({
  id: "get-user-activity",
  description: "Get activity statistics for a specific user including message count, reactions, voice time, and rank",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    userId: z.string().describe("The ID of the user"),
    startDate: z.string().optional().describe("Start date for activity range (ISO format, optional)"),
    endDate: z.string().optional().describe("End date for activity range (ISO format, optional)"),
    activityTypes: z.array(z.enum(["message", "reaction", "voice"])).optional()
      .describe("Filter by activity types (optional, defaults to all)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      userId: z.string(),
      messageCount: z.number(),
      reactionCount: z.number(),
      voiceMinutes: z.number(),
      totalActivity: z.number(),
      rank: z.number().describe("User's rank in the guild by total activity")
    }).optional()
  }),
  execute: async (input) => {
    const { guildId, userId, startDate, endDate } = input;
    return withToolSpan("get-user-activity", guildId, async () => {
      logger.debug("Getting user activity stats", {
        guildId,
        userId
      });
      try {
        const dateRange = startDate && endDate ? {
          start: new Date(startDate),
          end: new Date(endDate)
        } : undefined;

        const stats = await getUserActivityStats(
          guildId,
          userId,
          dateRange
        );

        logger.info("User activity stats retrieved", {
          guildId,
          userId,
          totalActivity: stats.totalActivity,
          rank: stats.rank
        });

        return {
          success: true,
          message: `User has ${stats.totalActivity.toString()} total activity points (rank #${stats.rank.toString()})`,
          data: {
            userId,
            ...stats
          }
        };
      } catch (error) {
        logger.error("Failed to get user activity", error, {
          guildId,
          userId
        });
        captureException(error as Error, {
          operation: "tool.get-user-activity",
          discord: { guildId, userId }
        });
        return {
          success: false,
          message: `Failed to retrieve activity stats: ${(error as Error).message}`
        };
      }
    });
  }
});

export const getTopActiveUsersTool = createTool({
  id: "get-top-active-users",
  description: "Get a leaderboard of the most active users in a guild by activity count",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    limit: z.number().min(1).max(100).optional().describe("Number of users to return (default: 10, max: 100)"),
    startDate: z.string().optional().describe("Start date for activity range (ISO format, optional)"),
    endDate: z.string().optional().describe("End date for activity range (ISO format, optional)"),
    activityType: z.enum(["message", "reaction", "voice", "all"]).optional()
      .describe("Type of activity to rank by (default: all)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      users: z.array(z.object({
        userId: z.string(),
        username: z.string().describe("Discord username of the user"),
        activityCount: z.number(),
        rank: z.number()
      }))
    }).optional()
  }),
  execute: async (input) => {
    const { guildId, limit, startDate, endDate, activityType } = input;
    return withToolSpan("get-top-active-users", guildId, async () => {
      logger.debug("Getting top active users", {
        guildId,
        limit
      });
      try {
        const dateRange =
          startDate && endDate
            ? {
                start: new Date(startDate),
                end: new Date(endDate),
              }
            : undefined;

        const topUsersOptions: Parameters<typeof getTopActiveUsers>[1] = {
          limit: limit ?? 10,
          activityType: activityType ?? "all",
        };
        if (dateRange !== undefined) {
          topUsersOptions.dateRange = dateRange;
        }

        const topUsers = await getTopActiveUsers(
          guildId,
          topUsersOptions
        );

        // Fetch usernames from Discord
        const client = getDiscordClient();
        const guild = await client.guilds.fetch(guildId);

        const usersWithNames = await Promise.all(
          topUsers.map(async (user) => {
            try {
              const member = await guild.members.fetch(user.userId);
              return {
                userId: user.userId,
                username: member.user.username,
                activityCount: user.activityCount,
                rank: user.rank
              };
            } catch (_error) {
              logger.warn("Could not fetch username for user", { userId: user.userId });
              return {
                userId: user.userId,
                username: "Unknown User",
                activityCount: user.activityCount,
                rank: user.rank
              };
            }
          })
        );

        logger.info("Top active users retrieved", {
          guildId,
          count: usersWithNames.length
        });

        return {
          success: true,
          message: `Retrieved top ${usersWithNames.length.toString()} active users`,
          data: {
            users: usersWithNames
          }
        };
      } catch (error) {
        logger.error("Failed to get top active users", error, {
          guildId
        });
        captureException(error as Error, {
          operation: "tool.get-top-active-users",
          discord: { guildId }
        });
        return {
          success: false,
          message: `Failed to retrieve top users: ${(error as Error).message}`
        };
      }
    });
  }
});

export const activityTools = [
  recordMessageActivityTool,
  recordReactionActivityTool,
  getUserActivityTool,
  getTopActiveUsersTool
];
