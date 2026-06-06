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
    It manages the music queue (add, remove, move, jump, shuffle, clear).
    It manages temporary per-server playlists.
    It controls volume and loop modes.
    It joins and leaves voice channels.
    Use this agent for any music playback, queue management, or voice channel task.`;

const MUSIC_RESPONSIBILITIES = `Play, pause, skip, stop music. Manage the queue (add, remove, move, jump, shuffle, clear). Control volume and loop modes. Join and leave voice channels. Manage temporary per-server playlists. Show recent tracks and music help.`;

const MUSIC_TOOL_GUIDANCE = `- Use \`music-playback\` for play/pause/resume/skip/stop/seek/volume/loop/now-playing/replay/recent/help.
- Use \`music-queue\` for queue get/add/remove/move/jump/shuffle/clear/summary.
- Use \`music-playlist\` for create/delete/rename/list/show/add/add-current/save-queue/remove/move/play/clear.
- When the user says "play X", call \`music-playback\` action="play" with the search query directly. The tool can infer the user's voice channel when available.
- Playlists are in-memory per server and disappear when Birmel restarts.
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
