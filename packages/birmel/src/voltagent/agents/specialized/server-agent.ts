import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { serverToolSet } from "@shepherdjerred/birmel/mastra/tools/tool-sets.ts";

const config = getConfig();

export const serverAgent = new Agent({
  name: "server-agent",
  purpose: `This agent handles Discord server/guild information.
    It gets server/guild information.
    It lists, creates, and modifies channels.
    It searches and manages members.
    It queries the database.
    Use this agent for server info, channel management, or member lookups.`,
  instructions: `You are a server information specialist for Discord.
    Handle server/guild queries, channel management, and member lookups.
    Provide accurate and helpful information.`,
  model: openai(config.openai.model),
  tools: serverToolSet,
});
