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
  execute: async ({ guildId }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
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
  execute: async ({ guildId, ruleId }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
      const rule = await guild.autoModerationRules.fetch(ruleId);

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
  execute: async ({ guildId, name, triggerType, keywords, keywordPresets, mentionLimit, enabled, reason }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);

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
        name,
        eventType: 1, // MESSAGE_SEND
        triggerType: triggerTypeMap[triggerType],
        triggerMetadata: {
          ...(keywords && { keywordFilter: keywords }),
          ...(keywordPresets && {
            presets: keywordPresets.map((p: "PROFANITY" | "SEXUAL_CONTENT" | "SLURS") => presetMap[p]),
          }),
          ...(mentionLimit !== undefined && {
            mentionTotalLimit: mentionLimit,
          }),
        },
        actions: [
          {
            type: AutoModerationActionType.BlockMessage,
          },
        ],
        ...(enabled !== undefined && { enabled }),
        ...(reason !== undefined && { reason }),
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
  execute: async ({ guildId, ruleId, reason }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
      const rule = await guild.autoModerationRules.fetch(ruleId);

      await rule.delete(reason);

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
  execute: async ({ guildId, ruleId, enabled, reason }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
      const rule = await guild.autoModerationRules.fetch(ruleId);

      await rule.setEnabled(enabled, reason);

      return {
        success: true,
        message: `${enabled ? "Enabled" : "Disabled"} auto-moderation rule: ${rule.name}`,
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
  execute: async ({ guildId, ruleId, name, keywords, mentionLimit, exemptRoles, exemptChannels, reason }) => {
    try {
      const client = getDiscordClient();
      const guild = await client.guilds.fetch(guildId);
      const rule = await guild.autoModerationRules.fetch(ruleId);

      const editOptions: Parameters<typeof rule.edit>[0] = {};
      if (name !== undefined) editOptions.name = name;
      if (keywords !== undefined) {
        editOptions.triggerMetadata = { keywordFilter: keywords };
      }
      if (mentionLimit !== undefined) {
        editOptions.triggerMetadata = {
          ...editOptions.triggerMetadata,
          mentionTotalLimit: mentionLimit,
        };
      }
      if (exemptRoles !== undefined) editOptions.exemptRoles = exemptRoles;
      if (exemptChannels !== undefined) editOptions.exemptChannels = exemptChannels;
      if (reason !== undefined) editOptions.reason = reason;

      const hasChanges =
        name !== undefined ||
        keywords !== undefined ||
        mentionLimit !== undefined ||
        exemptRoles !== undefined ||
        exemptChannels !== undefined;

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
