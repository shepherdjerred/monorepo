import { Agent } from "@voltagent/core";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../config/index.js";
import { createMemory } from "../memory/index.js";
import { SYSTEM_PROMPT, buildSystemPromptWithPersona } from "./system-prompt.js";

import { messagingAgent } from "./specialized/messaging-agent.js";
import { serverAgent } from "./specialized/server-agent.js";
import { moderationAgent } from "./specialized/moderation-agent.js";
import { musicAgent } from "./specialized/music-agent.js";
import { automationAgent } from "./specialized/automation-agent.js";
import { editorAgent } from "./specialized/editor-agent.js";

const config = getConfig();

/**
 * The routing agent coordinates all specialized agents.
 * It uses LLM reasoning to interpret requests and delegate to the appropriate agent(s).
 * Uses VoltAgent's supervisor pattern with subAgents.
 */
export const routingAgent = new Agent({
  name: "birmel-router",
  instructions: SYSTEM_PROMPT,
  model: openai(config.openai.model),
  subAgents: [
    messagingAgent,
    serverAgent,
    moderationAgent,
    musicAgent,
    automationAgent,
    editorAgent,
  ],
  supervisorConfig: {
    // Forward text-delta events from sub-agents for progressive streaming
    fullStreamEventForwarding: {
      types: ["text-delta", "tool-call", "tool-result"],
    },
  },
  memory: createMemory(),
  hooks: {
    // Skip supervisor post-processing - return sub-agent result directly
    // This saves tokens and reduces latency
    onHandoffComplete: ({ bail }) => {
      bail(); // Return sub-agent result directly without supervisor summarizing
    },
  },
});

/**
 * Create a routing agent instance with persona-embedded instructions.
 * This is useful for dynamic persona injection per-request.
 */
export function createRoutingAgentWithPersona(
  personaContext?: { name: string; description: string; voice: string; markers: string; samples: string[] } | null
) {
  return new Agent({
    name: "birmel-router",
    instructions: buildSystemPromptWithPersona(personaContext),
    model: openai(config.openai.model),
    subAgents: [
      messagingAgent,
      serverAgent,
      moderationAgent,
      musicAgent,
      automationAgent,
      editorAgent,
    ],
    supervisorConfig: {
      fullStreamEventForwarding: {
        types: ["text-delta", "tool-call", "tool-result"],
      },
    },
    memory: createMemory(),
    hooks: {
      onHandoffComplete: ({ bail }) => {
        bail();
      },
    },
  });
}

export { SYSTEM_PROMPT, buildSystemPromptWithPersona };
