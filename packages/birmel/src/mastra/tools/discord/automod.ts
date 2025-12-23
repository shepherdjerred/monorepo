import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { AutoModerationRuleTriggerType, AutoModerationActionType } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/index.js";

export const listAutomodRulesTool = createTool({
  id: "list-automod-rules",
  description: "List all auto-moderation rules in a guild",
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
          enabled: z.boolean(),
          triggerType: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const rules = await guild.autoModerationRules.fetch();

      const ruleList = rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        triggerType: AutoModerationRuleTriggerType[rule.triggerType],
      }));

      return {
        success: true,
        message: `Found ${String(ruleList.length)} auto-moderation rules`,
        data: ruleList,
      };
    } catch (error) {
      logger.error("Failed to list automod rules", error as Error);
      return {
        success: false,
        message: "Failed to list auto-moderation rules",
      };
    }
  },
});

export const getAutomodRuleTool = createTool({
  id: "get-automod-rule",
  description: "Get details of a specific auto-moderation rule",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    ruleId: z.string().describe("The ID of the rule"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        id: z.string(),
        name: z.string(),
        enabled: z.boolean(),
        triggerType: z.string(),
        exemptRoles: z.array(z.string()),
        exemptChannels: z.array(z.string()),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const rule = await guild.autoModerationRules.fetch(ctx.context.ruleId);

      return {
        success: true,
        message: `Found rule: ${rule.name}`,
        data: {
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          triggerType: AutoModerationRuleTriggerType[rule.triggerType],
          exemptRoles: rule.exemptRoles.map((r) => r.id),
          exemptChannels: rule.exemptChannels.map((c) => c.id),
        },
      };
    } catch (error) {
      logger.error("Failed to get automod rule", error as Error);
      return {
        success: false,
        message: "Failed to get auto-moderation rule",
      };
    }
  },
});

export const createAutomodRuleTool = createTool({
  id: "create-automod-rule",
  description: "Create a new auto-moderation rule",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    name: z.string().describe("Name of the rule"),
    triggerType: z
      .enum(["KEYWORD", "SPAM", "KEYWORD_PRESET", "MENTION_SPAM"])
      .describe("Type of trigger"),
    keywords: z
      .array(z.string())
      .optional()
      .describe("Keywords to match (for KEYWORD trigger)"),
    keywordPresets: z
      .array(z.enum(["PROFANITY", "SEXUAL_CONTENT", "SLURS"]))
      .optional()
      .describe("Preset filters (for KEYWORD_PRESET trigger)"),
    mentionLimit: z
      .number()
      .optional()
      .describe("Max mentions allowed (for MENTION_SPAM trigger)"),
    enabled: z.boolean().optional().describe("Whether the rule is enabled"),
    reason: z.string().optional().describe("Reason for creating the rule"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);

      const triggerTypeMap = {
        KEYWORD: AutoModerationRuleTriggerType.Keyword,
        SPAM: AutoModerationRuleTriggerType.Spam,
        KEYWORD_PRESET: AutoModerationRuleTriggerType.KeywordPreset,
        MENTION_SPAM: AutoModerationRuleTriggerType.MentionSpam,
      };

      const presetMap = {
        PROFANITY: 1,
        SEXUAL_CONTENT: 2,
        SLURS: 3,
      } as const;

      const rule = await guild.autoModerationRules.create({
        name: ctx.context.name,
        eventType: 1, // MESSAGE_SEND
        triggerType: triggerTypeMap[ctx.context.triggerType],
        triggerMetadata: {
          ...(ctx.context.keywords && { keywordFilter: ctx.context.keywords }),
          ...(ctx.context.keywordPresets && {
            presets: ctx.context.keywordPresets.map((p: "PROFANITY" | "SEXUAL_CONTENT" | "SLURS") => presetMap[p]),
          }),
          ...(ctx.context.mentionLimit !== undefined && {
            mentionTotalLimit: ctx.context.mentionLimit,
          }),
        },
        actions: [
          {
            type: AutoModerationActionType.BlockMessage,
          },
        ],
        ...(ctx.context.enabled !== undefined && { enabled: ctx.context.enabled }),
        ...(ctx.context.reason !== undefined && { reason: ctx.context.reason }),
      });

      return {
        success: true,
        message: `Created auto-moderation rule: ${rule.name}`,
        data: {
          id: rule.id,
          name: rule.name,
        },
      };
    } catch (error) {
      logger.error("Failed to create automod rule", error as Error);
      return {
        success: false,
        message: "Failed to create auto-moderation rule",
      };
    }
  },
});

export const deleteAutomodRuleTool = createTool({
  id: "delete-automod-rule",
  description: "Delete an auto-moderation rule",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    ruleId: z.string().describe("The ID of the rule to delete"),
    reason: z.string().optional().describe("Reason for deleting the rule"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const rule = await guild.autoModerationRules.fetch(ctx.context.ruleId);

      await rule.delete(ctx.context.reason);

      return {
        success: true,
        message: `Deleted auto-moderation rule: ${rule.name}`,
      };
    } catch (error) {
      logger.error("Failed to delete automod rule", error as Error);
      return {
        success: false,
        message: "Failed to delete auto-moderation rule",
      };
    }
  },
});

export const toggleAutomodRuleTool = createTool({
  id: "toggle-automod-rule",
  description: "Enable or disable an auto-moderation rule",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    ruleId: z.string().describe("The ID of the rule"),
    enabled: z.boolean().describe("Whether to enable or disable the rule"),
    reason: z.string().optional().describe("Reason for the change"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const rule = await guild.autoModerationRules.fetch(ctx.context.ruleId);

      await rule.setEnabled(ctx.context.enabled, ctx.context.reason);

      return {
        success: true,
        message: `${ctx.context.enabled ? "Enabled" : "Disabled"} auto-moderation rule: ${rule.name}`,
      };
    } catch (error) {
      logger.error("Failed to toggle automod rule", error as Error);
      return {
        success: false,
        message: "Failed to toggle auto-moderation rule",
      };
    }
  },
});

export const modifyAutomodRuleTool = createTool({
  id: "modify-automod-rule",
  description: "Modify an auto-moderation rule's settings",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    ruleId: z.string().describe("The ID of the rule to modify"),
    name: z.string().optional().describe("New name for the rule"),
    keywords: z
      .array(z.string())
      .optional()
      .describe("New keywords to match (for KEYWORD trigger)"),
    mentionLimit: z
      .number()
      .optional()
      .describe("New mention limit (for MENTION_SPAM trigger)"),
    exemptRoles: z
      .array(z.string())
      .optional()
      .describe("Role IDs to exempt from this rule"),
    exemptChannels: z
      .array(z.string())
      .optional()
      .describe("Channel IDs to exempt from this rule"),
    reason: z.string().optional().describe("Reason for modifying the rule"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (ctx) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.context.guildId);
      const rule = await guild.autoModerationRules.fetch(ctx.context.ruleId);

      const editOptions: Parameters<typeof rule.edit>[0] = {};
      if (ctx.context.name !== undefined) editOptions.name = ctx.context.name;
      if (ctx.context.keywords !== undefined) {
        editOptions.triggerMetadata = { keywordFilter: ctx.context.keywords };
      }
      if (ctx.context.mentionLimit !== undefined) {
        editOptions.triggerMetadata = {
          ...editOptions.triggerMetadata,
          mentionTotalLimit: ctx.context.mentionLimit,
        };
      }
      if (ctx.context.exemptRoles !== undefined) editOptions.exemptRoles = ctx.context.exemptRoles;
      if (ctx.context.exemptChannels !== undefined) editOptions.exemptChannels = ctx.context.exemptChannels;
      if (ctx.context.reason !== undefined) editOptions.reason = ctx.context.reason;

      const hasChanges =
        ctx.context.name !== undefined ||
        ctx.context.keywords !== undefined ||
        ctx.context.mentionLimit !== undefined ||
        ctx.context.exemptRoles !== undefined ||
        ctx.context.exemptChannels !== undefined;

      if (!hasChanges) {
        return {
          success: false,
          message: "No changes specified",
        };
      }

      await rule.edit(editOptions);

      return {
        success: true,
        message: `Updated auto-moderation rule: ${rule.name}`,
      };
    } catch (error) {
      logger.error("Failed to modify automod rule", error as Error);
      return {
        success: false,
        message: "Failed to modify auto-moderation rule",
      };
    }
  },
});

export const automodTools = [
  listAutomodRulesTool,
  getAutomodRuleTool,
  createAutomodRuleTool,
  modifyAutomodRuleTool,
  deleteAutomodRuleTool,
  toggleAutomodRuleTool,
];
