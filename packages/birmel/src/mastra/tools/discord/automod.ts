import {
  getErrorMessage,
  toError,
} from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import type { Guild } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";
import { validateSnowflakes, validateSnowflakeArray } from "./validation.ts";
import {
  handleListRules,
  handleGetRule,
  handleCreateRule,
  handleModifyRule,
  handleDeleteRule,
  handleToggleRule,
} from "./automod-actions.ts";

type AutomodInput = {
  guildId: string;
  action: string;
  ruleId?: string | undefined;
  name?: string | undefined;
  triggerType?: string | undefined;
  keywords?: string[] | undefined;
  keywordPresets?: string[] | undefined;
  mentionLimit?: number | undefined;
  exemptRoles?: string[] | undefined;
  exemptChannels?: string[] | undefined;
  enabled?: boolean | undefined;
  reason?: string | undefined;
};

function validateAutomodInput(
  ctx: AutomodInput,
): { success: boolean; message: string } | null {
  const idError = validateSnowflakes([
    { value: ctx.guildId, fieldName: "guildId" },
    { value: ctx.ruleId, fieldName: "ruleId" },
  ]);
  if (idError != null && idError.length > 0) {
    return { success: false, message: idError };
  }

  const rolesError = validateSnowflakeArray(ctx.exemptRoles, "exemptRoles");
  if (rolesError != null && rolesError.length > 0) {
    return { success: false, message: rolesError };
  }

  const channelsError = validateSnowflakeArray(
    ctx.exemptChannels,
    "exemptChannels",
  );
  if (channelsError != null && channelsError.length > 0) {
    return { success: false, message: channelsError };
  }

  return null;
}

function buildCreateOptions(ctx: AutomodInput): Record<string, unknown> {
  return {
    ...(ctx.name !== undefined && { name: ctx.name }),
    ...(ctx.triggerType !== undefined && { triggerType: ctx.triggerType }),
    ...(ctx.keywords !== undefined && { keywords: ctx.keywords }),
    ...(ctx.keywordPresets !== undefined && {
      keywordPresets: ctx.keywordPresets,
    }),
    ...(ctx.mentionLimit !== undefined && { mentionLimit: ctx.mentionLimit }),
    ...(ctx.enabled !== undefined && { enabled: ctx.enabled }),
    ...(ctx.reason !== undefined && { reason: ctx.reason }),
  };
}

function buildModifyOptions(ctx: AutomodInput): Record<string, unknown> {
  return {
    ...(ctx.ruleId !== undefined && { ruleId: ctx.ruleId }),
    ...(ctx.name !== undefined && { name: ctx.name }),
    ...(ctx.keywords !== undefined && { keywords: ctx.keywords }),
    ...(ctx.mentionLimit !== undefined && { mentionLimit: ctx.mentionLimit }),
    ...(ctx.exemptRoles !== undefined && { exemptRoles: ctx.exemptRoles }),
    ...(ctx.exemptChannels !== undefined && {
      exemptChannels: ctx.exemptChannels,
    }),
    ...(ctx.reason !== undefined && { reason: ctx.reason }),
  };
}

async function dispatchAutomodAction(guild: Guild, ctx: AutomodInput) {
  switch (ctx.action) {
    case "list":
      return await handleListRules(guild);
    case "get":
      return await handleGetRule(guild, ctx.ruleId);
    case "create":
      return await handleCreateRule(guild, buildCreateOptions(ctx));
    case "modify":
      return await handleModifyRule(guild, buildModifyOptions(ctx));
    case "delete":
      return await handleDeleteRule(guild, ctx.ruleId, ctx.reason);
    case "toggle":
      return await handleToggleRule(guild, ctx.ruleId, ctx.enabled, ctx.reason);
    default:
      return { success: false, message: `Unknown action: ${ctx.action}` };
  }
}

export const manageAutomodRuleTool = createTool({
  id: "manage-automod-rule",
  description:
    "Manage auto-moderation rules: list all, get details, create, modify, delete, or toggle enabled state",
  inputSchema: z.object({
    guildId: z.string().describe("The ID of the guild"),
    action: z
      .enum(["list", "get", "create", "modify", "delete", "toggle"])
      .describe("The action to perform"),
    ruleId: z
      .string()
      .optional()
      .describe("The ID of the rule (required for get/modify/delete/toggle)"),
    name: z
      .string()
      .optional()
      .describe("Name of the rule (required for create, optional for modify)"),
    triggerType: z
      .enum(["KEYWORD", "SPAM", "KEYWORD_PRESET", "MENTION_SPAM"])
      .optional()
      .describe("Type of trigger (required for create)"),
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
    exemptRoles: z
      .array(z.string())
      .optional()
      .describe("Role IDs to exempt from this rule"),
    exemptChannels: z
      .array(z.string())
      .optional()
      .describe("Channel IDs to exempt from this rule"),
    enabled: z
      .boolean()
      .optional()
      .describe("Whether the rule is enabled (for create/toggle)"),
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
      const validationError = validateAutomodInput(ctx);
      if (validationError != null) {
        return validationError;
      }

      const client = getDiscordClient();
      const guild = await client.guilds.fetch(ctx.guildId);

      return await dispatchAutomodAction(guild, ctx);
    } catch (error) {
      logger.error("Failed to manage automod rule", toError(error));
      return {
        success: false,
        message: `Failed to manage auto-moderation rule: ${getErrorMessage(error)}`,
      };
    }
  },
});

export const automodTools = [manageAutomodRuleTool];
