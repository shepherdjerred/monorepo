import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { messagingToolSet, toolsToRecord } from "../../tools/tool-sets.js";

const config = getConfig();

export const messagingAgent = new Agent({
  id: "messaging-agent",
  name: "Messaging Agent",
  description: `This agent handles Discord messaging operations.
    It can send, edit, delete, and pin messages.
    It creates and manages threads and polls.
    It schedules messages for later delivery.
    It tracks user activity and stores memories.
    Use this agent for any messaging, thread, poll, or memory-related task.`,
  instructions: `You are a messaging specialist for Discord.
    Handle message operations, threads, polls, and memory storage.
    Be concise and helpful.`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(messagingToolSet) as ToolsInput,
});
