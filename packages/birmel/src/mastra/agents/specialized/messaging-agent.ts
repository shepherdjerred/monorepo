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
    Be concise and helpful.

    IMPORTANT: You MUST use manage-message to send messages. Your text output is NOT automatically sent.
    Use action="reply" to respond to the user (uses Discord's native reply feature).
    Use action="send" to send messages to other channels (NOT for replying to the user).

    CRITICAL: Send exactly ONE reply per request. If the tool returns "ALREADY REPLIED", stop immediately.
    Do NOT attempt to send another reply - the user has already received the response.`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(messagingToolSet) as ToolsInput,
});
