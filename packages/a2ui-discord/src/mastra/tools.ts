/**
 * Mastra Tools for A2UI Discord Integration
 * Allows AI agents to create and manage interactive Discord UIs
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TextChannel, Client } from "discord.js";
import { getSurfaceStore, sendSurface, type SurfaceAction } from "./surface-store.js";
import {
  text,
  action,
  surfaceUpdate,
  dataModelUpdate,
  beginRendering,
  uid,
  resetUidCounter,
  infoCard,
  confirmDialog,
  progressCard,
  iconList,
} from "./builders.js";
import type { A2UIMessage, A2UIComponent } from "../types.js";

// ============= Zod Schemas =============

const ActionSchema = z.object({
  name: z.string().describe("The action name to trigger when clicked"),
  context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
    .describe("Optional context data to pass with the action"),
});

const ButtonSchema = z.object({
  label: z.string().describe("Button text"),
  action: ActionSchema.describe("Action to trigger when clicked"),
  primary: z.boolean().optional().describe("Use primary (blue) style"),
});

const IconItemSchema = z.object({
  icon: z.string().describe("Icon name (e.g., 'check-circle', 'alert', 'star')"),
  text: z.string().describe("Text next to the icon"),
});

// ============= Tool Result Type =============

const ToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
});

// ============= Discord Client Management =============

let discordClient: Client | null = null;

/**
 * Set the Discord client for tools to use
 */
export function setDiscordClient(client: Client): void {
  discordClient = client;
}

/**
 * Get the Discord client
 */
function getDiscordClient(): Client {
  if (!discordClient) {
    throw new Error("Discord client not set. Call setDiscordClient() first.");
  }
  return discordClient;
}

// ============= Action Handler Registry =============

type ActionHandler = (action: SurfaceAction) => void | Promise<void>;

let globalActionHandler: ActionHandler | null = null;

/**
 * Set a global action handler for when users interact with A2UI surfaces
 */
export function setActionHandler(handler: ActionHandler): void {
  globalActionHandler = handler;
}

/**
 * Get the global action handler
 */
export function getActionHandler(): ActionHandler | null {
  return globalActionHandler;
}

// ============= Tools =============

/**
 * Tool for creating interactive UI cards
 */
export const createUiCardTool = createTool({
  id: "create-ui-card",
  description: `Create an interactive UI card in Discord with title, description, and optional buttons.
Use this when you want to display structured information with actions the user can take.

Button actions should be descriptive names like "learn_more", "confirm", "cancel", etc.
When a user clicks a button, you'll receive the action name and any context you provided.`,
  inputSchema: z.object({
    channelId: z.string().describe("The Discord channel ID to send the UI to"),
    title: z.string().describe("Card title (displayed as heading)"),
    description: z.string().describe("Card description/content"),
    buttons: z.array(ButtonSchema).optional()
      .describe("Optional buttons for user interaction"),
  }),
  outputSchema: ToolResultSchema,
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel?.isTextBased()) {
        return { success: false, message: "Channel is not a text channel" };
      }

      resetUidCounter();
      const surfaceId = `ui-${String(Date.now())}`;

      // Build the UI
      const buttons = ctx.buttons?.map((btn) => {
        const buttonDef: { label: string; action: ReturnType<typeof action>; primary?: boolean } = {
          label: btn.label,
          action: action(btn.action.name, btn.action.context),
        };
        if (btn.primary !== undefined) {
          buttonDef.primary = btn.primary;
        }
        return buttonDef;
      });

      const { components, rootId } = infoCard(ctx.title, ctx.description, buttons);

      // Create the surface
      const store = getSurfaceStore();
      store.create(surfaceId, ctx.channelId, globalActionHandler ?? undefined);

      // Process messages
      const messages: A2UIMessage[] = [
        surfaceUpdate(surfaceId, components),
        beginRendering(surfaceId, rootId),
      ];
      store.processMessages(surfaceId, messages);

      // Send to Discord
      const message = await sendSurface(channel as TextChannel, surfaceId);

      if (!message) {
        return { success: false, message: "Failed to send UI to Discord" };
      }

      return {
        success: true,
        message: "UI card created successfully",
        data: { surfaceId, messageId: message.id },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create UI card: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Tool for creating confirmation dialogs
 */
export const createConfirmDialogTool = createTool({
  id: "create-confirm-dialog",
  description: `Create a confirmation dialog with Confirm/Cancel buttons.
Use this when you need the user to confirm an action before proceeding.

You'll receive either "confirm" or "cancel" action when the user clicks.`,
  inputSchema: z.object({
    channelId: z.string().describe("The Discord channel ID"),
    message: z.string().describe("The confirmation message/question"),
    confirmAction: z.string().optional()
      .describe("Action name for confirm button (default: 'confirm')"),
    cancelAction: z.string().optional()
      .describe("Action name for cancel button (default: 'cancel')"),
    context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
      .describe("Context data to include with both actions"),
  }),
  outputSchema: ToolResultSchema,
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel?.isTextBased()) {
        return { success: false, message: "Channel is not a text channel" };
      }

      resetUidCounter();
      const surfaceId = `confirm-${String(Date.now())}`;

      const { components, rootId } = confirmDialog(
        ctx.message,
        action(ctx.confirmAction ?? "confirm", ctx.context),
        action(ctx.cancelAction ?? "cancel", ctx.context)
      );

      const store = getSurfaceStore();
      store.create(surfaceId, ctx.channelId, globalActionHandler ?? undefined);

      const messages: A2UIMessage[] = [
        surfaceUpdate(surfaceId, components),
        beginRendering(surfaceId, rootId),
      ];
      store.processMessages(surfaceId, messages);

      const message = await sendSurface(channel as TextChannel, surfaceId);

      if (!message) {
        return { success: false, message: "Failed to send confirmation dialog" };
      }

      return {
        success: true,
        message: "Confirmation dialog created",
        data: { surfaceId, messageId: message.id },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create dialog: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Tool for creating progress indicators
 */
export const createProgressTool = createTool({
  id: "create-progress",
  description: `Create a progress indicator UI showing task completion status.
Use this to show progress on long-running tasks.`,
  inputSchema: z.object({
    channelId: z.string().describe("The Discord channel ID"),
    title: z.string().describe("Progress title"),
    progress: z.number().min(0).max(1).describe("Progress value from 0 to 1"),
    status: z.string().optional().describe("Optional status text"),
  }),
  outputSchema: ToolResultSchema,
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel?.isTextBased()) {
        return { success: false, message: "Channel is not a text channel" };
      }

      resetUidCounter();
      const surfaceId = `progress-${String(Date.now())}`;

      const { components, rootId } = progressCard(
        ctx.title,
        ctx.progress,
        ctx.status
      );

      const store = getSurfaceStore();
      store.create(surfaceId, ctx.channelId, globalActionHandler ?? undefined);

      const messages: A2UIMessage[] = [
        surfaceUpdate(surfaceId, components),
        beginRendering(surfaceId, rootId),
      ];
      store.processMessages(surfaceId, messages);

      const message = await sendSurface(channel as TextChannel, surfaceId);

      if (!message) {
        return { success: false, message: "Failed to send progress UI" };
      }

      return {
        success: true,
        message: "Progress UI created",
        data: { surfaceId, messageId: message.id },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create progress: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Tool for updating an existing progress UI
 */
export const updateProgressTool = createTool({
  id: "update-progress",
  description: `Update an existing progress indicator with new values.`,
  inputSchema: z.object({
    surfaceId: z.string().describe("The surface ID from create-progress"),
    channelId: z.string().describe("The Discord channel ID"),
    progress: z.number().min(0).max(1).describe("New progress value from 0 to 1"),
    status: z.string().optional().describe("New status text"),
  }),
  outputSchema: ToolResultSchema,
  execute: async (ctx) => {
    try {
      const store = getSurfaceStore();
      const surface = store.get(ctx.surfaceId);

      if (!surface) {
        return { success: false, message: "Surface not found" };
      }

      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel?.isTextBased()) {
        return { success: false, message: "Channel is not a text channel" };
      }

      // Update the data model
      const updateMsg = dataModelUpdate(ctx.surfaceId, {
        progress: ctx.progress,
        ...(ctx.status !== undefined ? { status: ctx.status } : {}),
      });

      store.processMessages(ctx.surfaceId, [updateMsg]);

      const message = await sendSurface(channel as TextChannel, ctx.surfaceId);

      if (!message) {
        return { success: false, message: "Failed to update progress UI" };
      }

      return {
        success: true,
        message: "Progress updated",
        data: { surfaceId: ctx.surfaceId },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update progress: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Tool for creating an icon list
 */
export const createIconListTool = createTool({
  id: "create-icon-list",
  description: `Create a list with icons next to each item.
Good for displaying features, steps, or status items.

Available icons: check-circle, x-circle, alert-circle, info, star, heart,
user, settings, search, play, pause, and many more.`,
  inputSchema: z.object({
    channelId: z.string().describe("The Discord channel ID"),
    title: z.string().optional().describe("Optional title above the list"),
    items: z.array(IconItemSchema).describe("List items with icons"),
  }),
  outputSchema: ToolResultSchema,
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const channel = await client.channels.fetch(ctx.channelId);

      if (!channel?.isTextBased()) {
        return { success: false, message: "Channel is not a text channel" };
      }

      resetUidCounter();
      const surfaceId = `list-${String(Date.now())}`;

      const { components: listComponents, rootId: listRootId } = iconList(ctx.items);

      let components = listComponents;
      let rootId = listRootId;

      // Add title if provided
      if (ctx.title) {
        const titleComp = text(ctx.title, "h3");
        const containerCol: A2UIComponent = {
          id: uid("container"),
          component: {
            Column: {
              children: { explicitList: [titleComp.id, listRootId] },
            },
          },
        };
        components = [titleComp, ...listComponents, containerCol];
        rootId = containerCol.id;
      }

      const store = getSurfaceStore();
      store.create(surfaceId, ctx.channelId, globalActionHandler ?? undefined);

      const messages: A2UIMessage[] = [
        surfaceUpdate(surfaceId, components),
        beginRendering(surfaceId, rootId),
      ];
      store.processMessages(surfaceId, messages);

      const message = await sendSurface(channel as TextChannel, surfaceId);

      if (!message) {
        return { success: false, message: "Failed to send list UI" };
      }

      return {
        success: true,
        message: "Icon list created",
        data: { surfaceId, messageId: message.id },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create list: ${(error as Error).message}`,
      };
    }
  },
});

/**
 * Tool for deleting a UI surface
 */
export const deleteUiTool = createTool({
  id: "delete-ui",
  description: `Delete a UI surface and optionally its Discord message.`,
  inputSchema: z.object({
    surfaceId: z.string().describe("The surface ID to delete"),
    channelId: z.string().describe("The Discord channel ID"),
    deleteMessage: z.boolean().optional()
      .describe("Whether to also delete the Discord message (default: true)"),
  }),
  outputSchema: ToolResultSchema,
  execute: async (ctx) => {
    try {
      const store = getSurfaceStore();
      const surface = store.get(ctx.surfaceId);

      if (!surface) {
        return { success: false, message: "Surface not found" };
      }

      // Delete the Discord message if requested
      if (ctx.deleteMessage !== false && surface.messageId) {
        try {
          const client = getDiscordClient();
          const channel = await client.channels.fetch(ctx.channelId);
          if (channel?.isTextBased()) {
            const message = await (channel as TextChannel).messages.fetch(surface.messageId);
            await message.delete();
          }
        } catch {
          // Message might already be deleted
        }
      }

      // Delete the surface
      store.delete(ctx.surfaceId);

      return {
        success: true,
        message: "UI deleted",
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete UI: ${(error as Error).message}`,
      };
    }
  },
});

// ============= Export all tools =============

export const a2uiTools = [
  createUiCardTool,
  createConfirmDialogTool,
  createProgressTool,
  updateProgressTool,
  createIconListTool,
  deleteUiTool,
];
