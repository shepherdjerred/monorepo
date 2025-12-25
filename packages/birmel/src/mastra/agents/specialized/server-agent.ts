import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { serverToolSet, toolsToRecord } from "../../tools/tool-sets.js";

const config = getConfig();

export const serverAgent = new Agent({
  id: "server-agent",
  name: "Server Agent",
  description: `This agent handles Discord server and guild operations.
    It retrieves server information and settings.
    It lists, creates, modifies, and deletes channels.
    It searches and manages server members.
    It queries the database for stored information.
    Use this agent for server info, channels, members, or database queries.`,
  instructions: `You are a server information specialist for Discord.
    Handle guild info, channel management, and member queries.
    Be concise and helpful.`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(serverToolSet) as ToolsInput,
});
