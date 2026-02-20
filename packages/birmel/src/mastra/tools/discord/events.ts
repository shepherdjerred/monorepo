import { getErrorMessage } from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import type { Guild } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { validateSnowflakes } from "./validation.ts";
import {
  handleListEvents,
  handleCreateEvent,
  handleModifyEvent,
  handleDeleteEvent,
  handleGetEventUsers,
} from "./event-actions.ts";

type EventInput = {
  guildId: string;
  action: string;
  eventId?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  scheduledStartTime?: string | undefined;
  scheduledEndTime?: string | undefined;
  location?: string | undefined;
  channelId?: string | undefined;
  limit?: number | undefined;
};

async function dispatchEventAction(guild: Guild, ctx: EventInput) {
  switch (ctx.action) {
    case "list":
      return await handleListEvents(guild);
    case "create":
      return await handleCreateEvent(guild, {
        ...(ctx.name !== undefined && { name: ctx.name }),
        ...(ctx.scheduledStartTime !== undefined && {
          scheduledStartTime: ctx.scheduledStartTime,
        }),
        ...(ctx.scheduledEndTime !== undefined && {
          scheduledEndTime: ctx.scheduledEndTime,
        }),
        ...(ctx.description !== undefined && { description: ctx.description }),
        ...(ctx.channelId !== undefined && { channelId: ctx.channelId }),
        ...(ctx.location !== undefined && { location: ctx.location }),
      });
    case "modify":
      return await handleModifyEvent(guild, {
        ...(ctx.eventId !== undefined && { eventId: ctx.eventId }),
        ...(ctx.name !== undefined && { name: ctx.name }),
        ...(ctx.description !== undefined && { description: ctx.description }),
        ...(ctx.scheduledStartTime !== undefined && {
          scheduledStartTime: ctx.scheduledStartTime,
        }),
        ...(ctx.scheduledEndTime !== undefined && {
          scheduledEndTime: ctx.scheduledEndTime,
        }),
        ...(ctx.location !== undefined && { location: ctx.location }),
      });
    case "delete":
      return await handleDeleteEvent(guild, ctx.eventId);
    case "get-users":
      return await handleGetEventUsers(guild, ctx.eventId, ctx.limit);
    default:
      return { success: false, message: `Unknown action: ${ctx.action}` };
  }
}

export const manageScheduledEventTool = createTool({
  id: "manage-scheduled-event",
  description:
    "Manage scheduled events: list all, create, modify, delete, or get interested users",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum(["list", "create", "modify", "delete", "get-users"])
      .describe("The action to perform"),
    eventId: z
      .string()
      .optional()
      .describe("The ID of the event (required for modify/delete/get-users)"),
    name: z
      .string()
      .optional()
      .describe("Name of the event (required for create, optional for modify)"),
    description: z.string().optional().describe("Description of the event"),
    scheduledStartTime: z
      .string()
      .optional()
      .describe("Start time in ISO 8601 format (required for create)"),
    scheduledEndTime: z
      .string()
      .optional()
      .describe("End time in ISO 8601 format"),
    location: z.string().optional().describe("Location for external events"),
    channelId: z
      .string()
      .optional()
      .describe("Voice channel ID for voice events"),
    limit: z
      .number()
      .optional()
      .describe("Maximum users to retrieve (for get-users, default 100)"),
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
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.eventId, fieldName: "eventId" },
        { value: ctx.channelId, fieldName: "channelId" },
      ]);
      if (idError != null && idError.length > 0) {
        return { success: false, message: idError };
      }

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      return await dispatchEventAction(guild, ctx);
    } catch (error) {
      logger.error("Failed to manage scheduled event", error);
      return {
        success: false,
        message: `Failed to manage scheduled event: ${getErrorMessage(error)}`,
      };
    }
  },
});

export const eventTools = [manageScheduledEventTool];
