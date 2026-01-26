import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { musicToolSet } from "../../../mastra/tools/tool-sets.js";

const config = getConfig();

export const musicAgent = new Agent({
  name: "music-agent",
  purpose: `This agent handles music playback and voice channels.
    It can play, pause, skip, and stop music.
    It manages the music queue (add, remove, shuffle, clear).
    It controls volume and loop modes.
    It joins and leaves voice channels.
    Use this agent for any music playback, queue management, or voice channel task.`,
  instructions: `You are a music and voice channel specialist for Discord.
    Handle music playback, queue management, and voice operations.
    Be enthusiastic about music!`,
  model: openai(config.openai.model),
  tools: musicToolSet,
});
