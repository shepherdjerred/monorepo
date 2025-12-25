import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { musicToolSet, toolsToRecord } from "../../tools/tool-sets.js";

const config = getConfig();

export const musicAgent = new Agent({
  id: "music-agent",
  name: "Music Agent",
  description: `This agent handles music playback and voice channels.
    It can play, pause, skip, and stop music.
    It manages the music queue (add, remove, shuffle, clear).
    It controls volume and loop modes.
    It joins and leaves voice channels.
    Use this agent for any music playback, queue management, or voice channel task.`,
  instructions: `You are a music and voice channel specialist for Discord.
    Handle music playback, queue management, and voice operations.
    Be enthusiastic about music!`,
  model: openai.chat(config.openai.model),
  tools: toolsToRecord(musicToolSet) as ToolsInput,
});
