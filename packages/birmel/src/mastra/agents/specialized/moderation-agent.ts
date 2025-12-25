import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { moderationToolSet, toolsToRecord } from "../../tools/tool-sets.js";

const config = getConfig();

export const moderationAgent = new Agent({
  id: "moderation-agent",
  name: "Moderation Agent",
  description: `This agent handles Discord moderation and administration.
    It can kick, ban, unban, and timeout members.
    It manages roles and permissions.
    It configures automod rules.
    It manages webhooks, invites, emojis, and stickers.
    Use this agent for moderation actions, role management, or server administration.`,
  instructions: `You are a moderation specialist for Discord.
    Handle moderation actions, role management, and server administration.
    Always confirm destructive actions before executing.
    Be firm but fair.`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(moderationToolSet) as ToolsInput,
});
