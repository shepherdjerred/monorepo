import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { messagingToolSet } from "../../../mastra/tools/tool-sets.js";

const config = getConfig();

export const messagingAgent = new Agent({
  name: "messaging-agent",
  purpose: `This agent handles Discord messaging operations.
    It can send, edit, delete, and pin messages.
    It creates and manages threads and polls.
    It schedules messages for later delivery.
    It tracks user activity and stores memories.
    Use this agent for any messaging, thread, poll, or memory-related task.`,
  instructions: `You are a messaging specialist for Discord.
    Handle message operations, threads, polls, and memory storage.
    Be concise and helpful.

    IMPORTANT: Your text output IS automatically sent as a reply to the user.
    - Use manage-message action="send" ONLY for sending to OTHER channels
    - Use manage-message for: edit, delete, pin, unpin, reactions, DMs, bulk operations
    - Do NOT use action="reply" - just output text directly`,
  model: openai(config.openai.model),
  tools: messagingToolSet,
});
