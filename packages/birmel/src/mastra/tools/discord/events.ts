import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const listScheduledEventsTool = createTool({
  id: "list-scheduled-events",
  description: "List all scheduled events in the server",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          scheduledStartTime: z.string(),
          scheduledEndTime: z.string().nullable(),
          status: z.string(),
          userCount: z.number().nullable(),
        }),
      )
      .optional(),
  }),
  execute: async ({ guildId }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
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
    } catch (error) {
      logger.error("Failed to list scheduled events", error);
      return {
        success: false,
        message: "Failed to list scheduled events",
      };
    }
  },
});

export const createScheduledEventTool = createTool({
  id: "create-scheduled-event",
  description: "Create a new scheduled event",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    name: z.string().describe("Name of the event"),
    description: z.string().optional().describe("Description of the event"),
    scheduledStartTime: z.string().describe("Start time (ISO 8601 format)"),
    scheduledEndTime: z.string().optional().describe("End time (ISO 8601 format)"),
    location: z.string().optional().describe("Location for external events"),
    channelId: z.string().optional().describe("Voice channel ID for voice events"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        eventId: z.string(),
      })
      .optional(),
  }),
  execute: async ({ guildId, name, description, scheduledStartTime, scheduledEndTime, location, channelId }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);

      const entityType = channelId
        ? GuildScheduledEventEntityType.Voice
        : GuildScheduledEventEntityType.External;

      const createOptions: Parameters<typeof guild.scheduledEvents.create>[0] = {
        name,
        scheduledStartTime: new Date(scheduledStartTime),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType,
      };

      if (description !== undefined) {
        createOptions.description = description;
      }
      if (scheduledEndTime !== undefined) {
        createOptions.scheduledEndTime = new Date(scheduledEndTime);
      }
      if (channelId !== undefined) {
        createOptions.channel = channelId;
      }
      if (location !== undefined && !channelId) {
        createOptions.entityMetadata = { location };
      }

      const event = await guild.scheduledEvents.create(createOptions);

      return {
        success: true,
        message: `Created event "${event.name}"`,
        data: {
          eventId: event.id,
        },
      };
    } catch (error) {
      logger.error("Failed to create scheduled event", error);
      return {
        success: false,
        message: "Failed to create scheduled event",
      };
    }
  },
});

export const deleteScheduledEventTool = createTool({
  id: "delete-scheduled-event",
  description: "Delete a scheduled event",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    eventId: z.string().describe("The ID of the event to delete"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ guildId, eventId }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
      const event = await guild.scheduledEvents.fetch(eventId);

      const eventName = event.name;
      await event.delete();

      return {
        success: true,
        message: `Deleted event "${eventName}"`,
      };
    } catch (error) {
      logger.error("Failed to delete scheduled event", error);
      return {
        success: false,
        message: "Failed to delete scheduled event",
      };
    }
  },
});

export const modifyScheduledEventTool = createTool({
  id: "modify-scheduled-event",
  description: "Modify an existing scheduled event",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    eventId: z.string().describe("The ID of the event to modify"),
    name: z.string().optional().describe("New name for the event"),
    description: z.string().optional().describe("New description"),
    scheduledStartTime: z.string().optional().describe("New start time (ISO 8601 format)"),
    scheduledEndTime: z.string().optional().describe("New end time (ISO 8601 format)"),
    location: z.string().optional().describe("New location (for external events)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ guildId, eventId, name, description, scheduledStartTime, scheduledEndTime, location }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
      const event = await guild.scheduledEvents.fetch(eventId);

      const editOptions: Parameters<typeof event.edit>[0] = {};
      if (name !== undefined) editOptions.name = name;
      if (description !== undefined) editOptions.description = description;
      if (scheduledStartTime !== undefined)
        editOptions.scheduledStartTime = new Date(scheduledStartTime);
      if (scheduledEndTime !== undefined)
        editOptions.scheduledEndTime = new Date(scheduledEndTime);
      if (location !== undefined)
        editOptions.entityMetadata = { location };

      const hasChanges =
        name !== undefined ||
        description !== undefined ||
        scheduledStartTime !== undefined ||
        scheduledEndTime !== undefined ||
        location !== undefined;

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
    } catch (error) {
      logger.error("Failed to modify scheduled event", error);
      return {
        success: false,
        message: "Failed to modify scheduled event",
      };
    }
  },
});

export const getEventUsersTool = createTool({
  id: "get-event-users",
  description: "Get users interested in a scheduled event",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    eventId: z.string().describe("The ID of the event"),
    limit: z.number().optional().describe("Maximum number of users to retrieve (default 100)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .array(
        z.object({
          userId: z.string(),
          username: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async ({ guildId, eventId, limit }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
      const event = await guild.scheduledEvents.fetch(eventId);

      const subscribers = await event.fetchSubscribers({ limit: limit ?? 100 });

      const userList = subscribers.map((sub: { user: { id: string; username: string } }) => ({
        userId: sub.user.id,
        username: sub.user.username,
      }));

      return {
        success: true,
        message: `Found ${String(userList.length)} interested users`,
        data: userList,
      };
    } catch (error) {
      logger.error("Failed to get event users", error);
      return {
        success: false,
        message: "Failed to get event users",
      };
    }
  },
});

export const eventTools = [
  listScheduledEventsTool,
  createScheduledEventTool,
  modifyScheduledEventTool,
  deleteScheduledEventTool,
  getEventUsersTool,
];
