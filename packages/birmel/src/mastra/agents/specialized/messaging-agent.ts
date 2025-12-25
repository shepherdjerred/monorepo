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

    IMPORTANT: Your text response is automatically sent as a reply to the user.
    Do NOT use manage-message to send your reply - just write your response directly.
    Only use manage-message "send" for messages to OTHER channels or DMs.

    CRITICAL: Never output meta-commentary or explain what you're doing.
    If you can't use a tool or a tool fails, just respond naturally.
    Your output should be the actual message content, not explanations about how you're responding.

    BAD: "This is a simple greeting that should be sent directly as a reply"
    GOOD: "Hey! What's up?"`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(messagingToolSet) as ToolsInput,
});
