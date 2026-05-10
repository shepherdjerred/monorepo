import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { musicToolSet } from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";
import { createMemory } from "@shepherdjerred/birmel/voltagent/memory/index.ts";
import { sanitizeReplayHook } from "@shepherdjerred/birmel/voltagent/agents/hooks.ts";
import {
  buildSubAgentPrompt,
  type PersonaContext,
} from "@shepherdjerred/birmel/voltagent/agents/system-prompt.ts";

const MUSIC_PURPOSE = `This agent handles music playback and voice channels.
    It can play, pause, skip, and stop music.
    It manages the music queue (add, remove, shuffle, clear).
    It controls volume and loop modes.
    It joins and leaves voice channels.
    Use this agent for any music playback, queue management, or voice channel task.`;

const MUSIC_RESPONSIBILITIES = `Play, pause, skip, stop music. Manage the queue (add, remove, shuffle, clear). Control volume and loop modes. Join and leave voice channels.`;

const MUSIC_TOOL_GUIDANCE = `- Use \`manage-playback\` for play/pause/skip/stop/volume/loop and \`manage-queue\` for queue mutations.
- When the user says "play X", call \`manage-playback\` action="play" with the search query directly — don't ask which song they meant.
- If joining a voice channel fails (user not in voice, missing permissions), say so clearly in one line.`;

export function createMusicAgent(persona: PersonaContext | null): Agent {
  const config = getConfig();
  return new Agent({
    name: "music-agent",
    purpose: MUSIC_PURPOSE,
    instructions: buildSubAgentPrompt({
      agentName: "music-agent",
      responsibilities: MUSIC_RESPONSIBILITIES,
      toolGuidance: MUSIC_TOOL_GUIDANCE,
      persona,
    }),
    model: openai(config.openai.model),
    tools: musicToolSet,
    memory: createMemory(),
    hooks: {
      onPrepareMessages: sanitizeReplayHook,
    },
  });
}

export const musicAgent = createMusicAgent(null);
