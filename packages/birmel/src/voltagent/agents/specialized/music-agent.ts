import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../../config/index.js";
import { musicToolSet } from "../../../mastra/tools/tool-sets.js";
import { memberTools } from "../../../mastra/tools/discord/members.js";

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
    Be enthusiastic about music!

    IMPORTANT: To play music, you MUST first get the user's current voice channel:
    1. Use the manage-member tool with action "get" and the user's ID to get their voiceChannelId
    2. If voiceChannelId is null, the user is not in a voice channel - tell them to join one first
    3. Pass the voiceChannelId to the music-playback tool as the voiceChannelId parameter`,
  model: openai(config.openai.model),
  tools: [...musicToolSet, ...memberTools],
});
