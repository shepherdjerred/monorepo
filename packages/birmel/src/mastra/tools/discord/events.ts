import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";
import { validateSnowflakes } from "./validation.js";

export const manageScheduledEventTool = createTool({
  id: "manage-scheduled-event",
  description: "Manage scheduled events: list all, create, modify, delete, or get interested users",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["list", "create", "modify", "delete", "get-users"]).describe("The action to perform"),
    eventId: z.string().optional().describe("The ID of the event (required for modify/delete/get-users)"),
    name: z.string().optional().describe("Name of the event (required for create, optional for modify)"),
    description: z.string().optional().describe("Description of the event"),
    scheduledStartTime: z.string().optional().describe("Start time in ISO 8601 format (required for create)"),
    scheduledEndTime: z.string().optional().describe("End time in ISO 8601 format"),
    location: z.string().optional().describe("Location for external events"),
    channelId: z.string().optional().describe("Voice channel ID for voice events"),
    limit: z.number().optional().describe("Maximum users to retrieve (for get-users, default 100)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            scheduledStartTime: z.string(),
            scheduledEndTime: z.string().nullable(),
            status: z.string(),
            userCount: z.number().nullable(),
          }),
        ),
        z.object({
          eventId: z.string(),
        }),
        z.array(
          z.object({
            userId: z.string(),
            username: z.string(),
          }),
        ),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.eventId, fieldName: "eventId" },
        { value: ctx.channelId, fieldName: "channelId" },
      ]);
      if (idError) return { success: false, message: idError };

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "list": {
          const events = await guild.scheduledEvents.fetch();
          const eventList = events.map((event) => ({
            id: event.id,
            name: event.name,
            description: event.description,
            scheduledStartTime: event.scheduledStartAt?.toISOString() ?? "",
            scheduledEndTime: event.scheduledEndAt?.toISOString() ?? null,
            status: event.status.toString(),
            userCount: event.userCount,
          }));
          return {
            success: true,
            message: `Found ${String(eventList.length)} scheduled events`,
            data: eventList,
          };
        }

        case "create": {
          if (!ctx.name || !ctx.scheduledStartTime) {
            return {
              success: false,
              message: "name and scheduledStartTime are required for creating an event",
            };
          }
          const entityType = ctx.channelId
            ? GuildScheduledEventEntityType.Voice
            : GuildScheduledEventEntityType.External;
          const createOptions: Parameters<typeof guild.scheduledEvents.create>[0] = {
            name: ctx.name,
            scheduledStartTime: new Date(ctx.scheduledStartTime),
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityType,
          };
          if (ctx.description !== undefined) {
            createOptions.description = ctx.description;
          }
          if (ctx.scheduledEndTime !== undefined) {
            createOptions.scheduledEndTime = new Date(ctx.scheduledEndTime);
          }
          if (ctx.channelId !== undefined) {
            createOptions.channel = ctx.channelId;
          }
          if (ctx.location !== undefined && !ctx.channelId) {
            createOptions.entityMetadata = { location: ctx.location };
          }
          const event = await guild.scheduledEvents.create(createOptions);
          return {
            success: true,
            message: `Created event "${event.name}"`,
            data: { eventId: event.id },
          };
        }

        case "modify": {
          if (!ctx.eventId) {
            return {
              success: false,
              message: "eventId is required for modifying an event",
            };
          }
          const event = await guild.scheduledEvents.fetch(ctx.eventId);
          const editOptions: Parameters<typeof event.edit>[0] = {};
          if (ctx.name !== undefined) editOptions.name = ctx.name;
          if (ctx.description !== undefined) editOptions.description = ctx.description;
          if (ctx.scheduledStartTime !== undefined)
            editOptions.scheduledStartTime = new Date(ctx.scheduledStartTime);
          if (ctx.scheduledEndTime !== undefined)
            editOptions.scheduledEndTime = new Date(ctx.scheduledEndTime);
          if (ctx.location !== undefined) editOptions.entityMetadata = { location: ctx.location };
          const hasChanges =
            ctx.name !== undefined ||
            ctx.description !== undefined ||
            ctx.scheduledStartTime !== undefined ||
            ctx.scheduledEndTime !== undefined ||
            ctx.location !== undefined;
          if (!hasChanges) {
            return {
              success: false,
              message: "No changes specified",
            };
          }
          await event.edit(editOptions);
          return {
            success: true,
            message: `Updated event "${event.name}"`,
          };
        }

        case "delete": {
          if (!ctx.eventId) {
            return {
              success: false,
              message: "eventId is required for deleting an event",
            };
          }
          const event = await guild.scheduledEvents.fetch(ctx.eventId);
          const eventName = event.name;
          await event.delete();
          return {
            success: true,
            message: `Deleted event "${eventName}"`,
          };
        }

        case "get-users": {
          if (!ctx.eventId) {
            return {
              success: false,
              message: "eventId is required for getting event users",
            };
          }
          const event = await guild.scheduledEvents.fetch(ctx.eventId);
          const subscribers = await event.fetchSubscribers({ limit: ctx.limit ?? 100 });
          const userList = subscribers.map((sub: { user: { id: string; username: string } }) => ({
            userId: sub.user.id,
            username: sub.user.username,
          }));
          return {
            success: true,
            message: `Found ${String(userList.length)} interested users`,
            data: userList,
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage scheduled event", error);
      return {
        success: false,
        message: `Failed to manage scheduled event: ${(error as Error).message}`,
      };
    }
  },
});

export const eventTools = [manageScheduledEventTool];
