import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { moderationToolSet } from "@shepherdjerred/birmel/mastra/tools/tool-sets.ts";

const config = getConfig();

export const moderationAgent = new Agent({
  name: "moderation-agent",
  purpose: `This agent handles Discord moderation and administration.
    It can kick, ban, unban, and timeout members.
    It manages roles and permissions.
    It configures automod rules.
    It manages webhooks, invites, emojis, and stickers.
    Use this agent for moderation actions, role management, or server administration.`,
  instructions: `You are a moderation specialist for Discord.
    Handle moderation actions, role management, and server administration.
    Always confirm destructive actions before executing.
    Be firm but fair.`,
  model: openai(config.openai.model),
  tools: moderationToolSet,
});
