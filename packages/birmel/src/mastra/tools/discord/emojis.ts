import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/logger.js";

export const manageEmojiTool = createTool({
  id: "manage-emoji",
  description: "Manage custom emojis in the server: list all, create new, modify, or delete",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["list", "create", "modify", "delete"]).describe("The action to perform"),
    emojiId: z.string().optional().describe("The ID of the emoji (required for modify/delete)"),
    name: z.string().optional().describe("Name for the emoji (required for create, optional for modify)"),
    imageUrl: z.string().optional().describe("URL of the image to use (required for create)"),
    reason: z.string().optional().describe("Reason for the action"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.array(
          z.object({
            id: z.string(),
            name: z.string().nullable(),
            animated: z.boolean(),
            url: z.string(),
          }),
        ),
        z.object({
          emojiId: z.string(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "list": {
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
        }

        case "create": {
          if (!ctx.name || !ctx.imageUrl) {
            return {
              success: false,
              message: "Name and imageUrl are required for creating an emoji",
            };
          }
          const emoji = await guild.emojis.create({
            attachment: ctx.imageUrl,
            name: ctx.name,
          });
          return {
            success: true,
            message: `Created emoji :${emoji.name}:`,
            data: { emojiId: emoji.id },
          };
        }

        case "modify": {
          if (!ctx.emojiId) {
            return {
              success: false,
              message: "emojiId is required for modifying an emoji",
            };
          }
          if (!ctx.name) {
            return {
              success: false,
              message: "name is required for modifying an emoji",
            };
          }
          const emoji = await guild.emojis.fetch(ctx.emojiId);
          const editOptions: Parameters<typeof emoji.edit>[0] = { name: ctx.name };
          if (ctx.reason !== undefined) editOptions.reason = ctx.reason;
          await emoji.edit(editOptions);
          return {
            success: true,
            message: `Renamed emoji to :${ctx.name}:`,
          };
        }

        case "delete": {
          if (!ctx.emojiId) {
            return {
              success: false,
              message: "emojiId is required for deleting an emoji",
            };
          }
          const emoji = await guild.emojis.fetch(ctx.emojiId);
          const emojiName = emoji.name;
          await emoji.delete(ctx.reason);
          return {
            success: true,
            message: `Deleted emoji :${emojiName}:`,
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage emoji", error);
      return {
        success: false,
        message: "Failed to manage emoji",
      };
    }
  },
});

export const manageStickerTool = createTool({
  id: "manage-sticker",
  description: "Manage custom stickers in the server: list all, create new, or delete",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["list", "create", "delete"]).describe("The action to perform"),
    stickerId: z.string().optional().describe("The ID of the sticker (required for delete)"),
    name: z.string().optional().describe("Name for the sticker (required for create)"),
    description: z.string().optional().describe("Description of the sticker (required for create)"),
    tags: z.string().optional().describe("Emoji tag for the sticker (required for create)"),
    imageUrl: z.string().optional().describe("URL of the image to use (required for create)"),
    reason: z.string().optional().describe("Reason for the action"),
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
            tags: z.string(),
            url: z.string(),
          }),
        ),
        z.object({
          stickerId: z.string(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "list": {
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
        }

        case "create": {
          if (!ctx.name || !ctx.description || !ctx.tags || !ctx.imageUrl) {
            return {
              success: false,
              message: "name, description, tags, and imageUrl are required for creating a sticker",
            };
          }
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
            data: { stickerId: sticker.id },
          };
        }

        case "delete": {
          if (!ctx.stickerId) {
            return {
              success: false,
              message: "stickerId is required for deleting a sticker",
            };
          }
          const sticker = await guild.stickers.fetch(ctx.stickerId);
          const stickerName = sticker.name;
          await sticker.delete(ctx.reason);
          return {
            success: true,
            message: `Deleted sticker "${stickerName}"`,
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage sticker", error);
      return {
        success: false,
        message: "Failed to manage sticker",
      };
    }
  },
});

export const emojiTools = [manageEmojiTool, manageStickerTool];
