import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const listEmojisTool = createTool({
  id: "list-emojis",
  description: "List all custom emojis in the server",
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
          name: z.string().nullable(),
          animated: z.boolean(),
          url: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const emojis = await guild.emojis.fetch();

      const emojiList = emojis.map((emoji) => ({
        id: emoji.id,
        name: emoji.name,
        animated: emoji.animated,
        url: emoji.imageURL(),
      }));

      return {
        success: true,
        message: `Found ${String(emojiList.length)} emojis`,
        data: emojiList,
      };
    } catch (error) {
      logger.error("Failed to list emojis", error);
      return {
        success: false,
        message: "Failed to list emojis",
      };
    }
  },
});

export const createEmojiTool = createTool({
  id: "create-emoji",
  description: "Create a new custom emoji from a URL",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    name: z.string().describe("Name for the emoji"),
    imageUrl: z.string().describe("URL of the image to use"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        emojiId: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      const emoji = await guild.emojis.create({
        attachment: ctx.imageUrl,
        name: ctx.name,
      });

      return {
        success: true,
        message: `Created emoji :${emoji.name}:`,
        data: {
          emojiId: emoji.id,
        },
      };
    } catch (error) {
      logger.error("Failed to create emoji", error);
      return {
        success: false,
        message: "Failed to create emoji",
      };
    }
  },
});

export const deleteEmojiTool = createTool({
  id: "delete-emoji",
  description: "Delete a custom emoji",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    emojiId: z.string().describe("The ID of the emoji to delete"),
    reason: z.string().optional().describe("Reason for deleting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const emoji = await guild.emojis.fetch(ctx.emojiId);

      const emojiName = emoji.name;
      await emoji.delete(ctx.reason);

      return {
        success: true,
        message: `Deleted emoji :${emojiName}:`,
      };
    } catch (error) {
      logger.error("Failed to delete emoji", error);
      return {
        success: false,
        message: "Failed to delete emoji",
      };
    }
  },
});

export const modifyEmojiTool = createTool({
  id: "modify-emoji",
  description: "Modify a custom emoji's name",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    emojiId: z.string().describe("The ID of the emoji to modify"),
    name: z.string().describe("New name for the emoji"),
    reason: z.string().optional().describe("Reason for modifying"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const emoji = await guild.emojis.fetch(ctx.emojiId);

      const editOptions: Parameters<typeof emoji.edit>[0] = { name: ctx.name };
      if (ctx.reason !== undefined) editOptions.reason = ctx.reason;
      await emoji.edit(editOptions);

      return {
        success: true,
        message: `Renamed emoji to :${ctx.name}:`,
      };
    } catch (error) {
      logger.error("Failed to modify emoji", error);
      return {
        success: false,
        message: "Failed to modify emoji",
      };
    }
  },
});

export const listStickersTool = createTool({
  id: "list-stickers",
  description: "List all custom stickers in the server",
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
          tags: z.string(),
          url: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const stickers = await guild.stickers.fetch();

      const stickerList = stickers.map((sticker) => ({
        id: sticker.id,
        name: sticker.name,
        description: sticker.description,
        tags: sticker.tags ?? "",
        url: sticker.url,
      }));

      return {
        success: true,
        message: `Found ${String(stickerList.length)} stickers`,
        data: stickerList,
      };
    } catch (error) {
      logger.error("Failed to list stickers", error);
      return {
        success: false,
        message: "Failed to list stickers",
      };
    }
  },
});

export const createStickerTool = createTool({
  id: "create-sticker",
  description: "Create a new custom sticker from a URL",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    name: z.string().describe("Name for the sticker"),
    description: z.string().describe("Description of the sticker"),
    tags: z.string().describe("Emoji tag for the sticker (e.g., 'wave')"),
    imageUrl: z.string().describe("URL of the image to use (PNG, APNG, or Lottie JSON)"),
    reason: z.string().optional().describe("Reason for creating"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        stickerId: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      const createOptions: Parameters<typeof guild.stickers.create>[0] = {
        file: ctx.imageUrl,
        name: ctx.name,
        tags: ctx.tags,
        description: ctx.description,
      };
      if (ctx.reason !== undefined) createOptions.reason = ctx.reason;
      const sticker = await guild.stickers.create(createOptions);

      return {
        success: true,
        message: `Created sticker "${sticker.name}"`,
        data: {
          stickerId: sticker.id,
        },
      };
    } catch (error) {
      logger.error("Failed to create sticker", error);
      return {
        success: false,
        message: "Failed to create sticker",
      };
    }
  },
});

export const deleteStickerTool = createTool({
  id: "delete-sticker",
  description: "Delete a custom sticker",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    stickerId: z.string().describe("The ID of the sticker to delete"),
    reason: z.string().optional().describe("Reason for deleting"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);
      const sticker = await guild.stickers.fetch(ctx.stickerId);

      const stickerName = sticker.name;
      await sticker.delete(ctx.reason);

      return {
        success: true,
        message: `Deleted sticker "${stickerName}"`,
      };
    } catch (error) {
      logger.error("Failed to delete sticker", error);
      return {
        success: false,
        message: "Failed to delete sticker",
      };
    }
  },
});

export const emojiTools = [
  listEmojisTool,
  createEmojiTool,
  modifyEmojiTool,
  deleteEmojiTool,
  listStickersTool,
  createStickerTool,
  deleteStickerTool,
];
