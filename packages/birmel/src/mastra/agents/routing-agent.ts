import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { getConfig } from "../../config/index.js";
import { createMemory } from "../memory/index.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

import { messagingAgent } from "./specialized/messaging-agent.js";
import { serverAgent } from "./specialized/server-agent.js";
import { moderationAgent } from "./specialized/moderation-agent.js";
import { musicAgent } from "./specialized/music-agent.js";
import { automationAgent } from "./specialized/automation-agent.js";

const config = getConfig();

/**
 * The routing agent coordinates all specialized agents.
 * It uses LLM reasoning to interpret requests and delegate to the appropriate agent(s).
 * Memory is required for .network() to track task history and completion.
 */
export const routingAgent = new Agent({
  id: "birmel-router",
  name: "Birmel",
  instructions: SYSTEM_PROMPT,
  model: openai.chat(config.openai.model),
  agents: {
    messagingAgent,
    serverAgent,
    moderationAgent,
    musicAgent,
    automationAgent,
  },
  memory: createMemory(),
});

/**
 * Create a routing agent instance.
 * This is useful when you need a fresh instance or custom configuration.
 */
export function createRoutingAgent() {
  return new Agent({
    id: "birmel-router",
    name: "Birmel",
    instructions: SYSTEM_PROMPT,
    model: openai.chat(config.openai.model),
    agents: {
      messagingAgent,
      serverAgent,
      moderationAgent,
      musicAgent,
      automationAgent,
    },
    memory: createMemory(),
  });
}
