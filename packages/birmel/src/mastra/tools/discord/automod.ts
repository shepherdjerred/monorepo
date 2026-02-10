import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { AutoModerationRuleTriggerType, AutoModerationActionType } from "discord.js";
import { getDiscordClient } from "../../../discord/index.js";
import { logger } from "../../../utils/index.js";
import { validateSnowflakes, validateSnowflakeArray } from "./validation.js";

export const manageAutomodRuleTool = createTool({
  id: "manage-automod-rule",
  description: "Manage auto-moderation rules: list all, get details, create, modify, delete, or toggle enabled state",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z.enum(["list", "get", "create", "modify", "delete", "toggle"]).describe("The action to perform"),
    ruleId: z.string().optional().describe("The ID of the rule (required for get/modify/delete/toggle)"),
    name: z.string().optional().describe("Name of the rule (required for create, optional for modify)"),
    triggerType: z
      .enum(["KEYWORD", "SPAM", "KEYWORD_PRESET", "MENTION_SPAM"])
      .optional()
      .describe("Type of trigger (required for create)"),
    keywords: z.array(z.string()).optional().describe("Keywords to match (for KEYWORD trigger)"),
    keywordPresets: z
      .array(z.enum(["PROFANITY", "SEXUAL_CONTENT", "SLURS"]))
      .optional()
      .describe("Preset filters (for KEYWORD_PRESET trigger)"),
    mentionLimit: z.number().optional().describe("Max mentions allowed (for MENTION_SPAM trigger)"),
    exemptRoles: z.array(z.string()).optional().describe("Role IDs to exempt from this rule"),
    exemptChannels: z.array(z.string()).optional().describe("Channel IDs to exempt from this rule"),
    enabled: z.boolean().optional().describe("Whether the rule is enabled (for create/toggle)"),
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
            enabled: z.boolean(),
            triggerType: z.string(),
          }),
        ),
        z.object({
          id: z.string(),
          name: z.string(),
          enabled: z.boolean(),
          triggerType: z.string(),
          exemptRoles: z.array(z.string()),
          exemptChannels: z.array(z.string()),
        }),
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    try {
      // Validate all Discord IDs before making API calls
      const idError = validateSnowflakes([
        { value: ctx.guildId, fieldName: "guildId" },
        { value: ctx.ruleId, fieldName: "ruleId" },
      ]);
      if (idError) {return { success: false, message: idError };}

      const rolesError = validateSnowflakeArray(ctx.exemptRoles, "exemptRoles");
      if (rolesError) {return { success: false, message: rolesError };}

      const channelsError = validateSnowflakeArray(ctx.exemptChannels, "exemptChannels");
      if (channelsError) {return { success: false, message: channelsError };}

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      switch (ctx.action) {
        case "list": {
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
        }

        case "get": {
          if (!ctx.ruleId) {
            return {
              success: false,
              message: "ruleId is required for getting rule details",
            };
          }
          const rule = await guild.autoModerationRules.fetch(ctx.ruleId);
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
        }

        case "create": {
          if (!ctx.name || !ctx.triggerType) {
            return {
              success: false,
              message: "name and triggerType are required for creating a rule",
            };
          }
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
            name: ctx.name,
            eventType: 1, // MESSAGE_SEND
            triggerType: triggerTypeMap[ctx.triggerType],
            triggerMetadata: {
              ...(ctx.keywords && { keywordFilter: ctx.keywords }),
              ...(ctx.keywordPresets && {
                presets: ctx.keywordPresets.map(
                  (p: "PROFANITY" | "SEXUAL_CONTENT" | "SLURS") => presetMap[p],
                ),
              }),
              ...(ctx.mentionLimit !== undefined && {
                mentionTotalLimit: ctx.mentionLimit,
              }),
            },
            actions: [
              {
                type: AutoModerationActionType.BlockMessage,
              },
            ],
            ...(ctx.enabled !== undefined && { enabled: ctx.enabled }),
            ...(ctx.reason !== undefined && { reason: ctx.reason }),
          });
          return {
            success: true,
            message: `Created auto-moderation rule: ${rule.name}`,
            data: {
              id: rule.id,
              name: rule.name,
            },
          };
        }

        case "modify": {
          if (!ctx.ruleId) {
            return {
              success: false,
              message: "ruleId is required for modifying a rule",
            };
          }
          const rule = await guild.autoModerationRules.fetch(ctx.ruleId);
          const editOptions: Parameters<typeof rule.edit>[0] = {};
          if (ctx.name !== undefined) {editOptions.name = ctx.name;}
          if (ctx.keywords !== undefined) {
            editOptions.triggerMetadata = { keywordFilter: ctx.keywords };
          }
          if (ctx.mentionLimit !== undefined) {
            editOptions.triggerMetadata = {
              ...editOptions.triggerMetadata,
              mentionTotalLimit: ctx.mentionLimit,
            };
          }
          if (ctx.exemptRoles !== undefined) {editOptions.exemptRoles = ctx.exemptRoles;}
          if (ctx.exemptChannels !== undefined) {editOptions.exemptChannels = ctx.exemptChannels;}
          if (ctx.reason !== undefined) {editOptions.reason = ctx.reason;}
          const hasChanges =
            ctx.name !== undefined ||
            ctx.keywords !== undefined ||
            ctx.mentionLimit !== undefined ||
            ctx.exemptRoles !== undefined ||
            ctx.exemptChannels !== undefined;
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
        }

        case "delete": {
          if (!ctx.ruleId) {
            return {
              success: false,
              message: "ruleId is required for deleting a rule",
            };
          }
          const rule = await guild.autoModerationRules.fetch(ctx.ruleId);
          const ruleName = rule.name;
          await rule.delete(ctx.reason);
          return {
            success: true,
            message: `Deleted auto-moderation rule: ${ruleName}`,
          };
        }

        case "toggle": {
          if (!ctx.ruleId) {
            return {
              success: false,
              message: "ruleId is required for toggling a rule",
            };
          }
          if (ctx.enabled === undefined) {
            return {
              success: false,
              message: "enabled is required for toggling a rule",
            };
          }
          const rule = await guild.autoModerationRules.fetch(ctx.ruleId);
          await rule.setEnabled(ctx.enabled, ctx.reason);
          return {
            success: true,
            message: `${ctx.enabled ? "Enabled" : "Disabled"} auto-moderation rule: ${rule.name}`,
          };
        }
      }
    } catch (error) {
      logger.error("Failed to manage automod rule", error as Error);
      return {
        success: false,
        message: `Failed to manage auto-moderation rule: ${(error as Error).message}`,
      };
    }
  },
});

export const automodTools = [manageAutomodRuleTool];
