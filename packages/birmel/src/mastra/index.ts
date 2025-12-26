import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getMastraObservability } from "./telemetry/index.js";

// Import routing agent and specialized agents
import { routingAgent } from "./agents/routing-agent.js";
import {
  messagingAgent,
  serverAgent,
  moderationAgent,
  musicAgent,
  automationAgent,
} from "./agents/specialized/index.js";
import { createClassifierAgent } from "./agents/classifier-agent.js";
import { stylizationAgent } from "./agents/stylization-agent.js";

// Import workflows
import { prepareMessageWorkflow } from "./workflows/index.js";

const classifierAgent = createClassifierAgent();
const config = getConfig();

/**
 * The main Mastra instance for Birmel.
 * Exported as `mastra` for Mastra CLI compatibility.
 */
export const mastra = new Mastra({
  agents: {
    // Main routing agent for Agent Networks
    birmel: routingAgent,
    // Specialized sub-agents
    messaging: messagingAgent,
    server: serverAgent,
    moderation: moderationAgent,
    music: musicAgent,
    automation: automationAgent,
    // Utility agents
    classifier: classifierAgent,
    stylizer: stylizationAgent,
  },
  workflows: {
    prepareMessage: prepareMessageWorkflow,
  },
  storage: new LibSQLStore({
    id: "telemetry",
    url: config.mastra.telemetryDbPath,
  }),
  observability: getMastraObservability(),
});

/**
 * @deprecated Use `mastra` directly instead
 */
export function getMastra(): Mastra {
  return mastra;
}

/**
 * Get the main routing agent for Agent Networks
 */
export function getRoutingAgent() {
  return routingAgent;
}

export function getClassifierAgent() {
  return mastra.getAgent("classifier");
}

export function getPrepareMessageWorkflow() {
  return mastra.getWorkflow("prepareMessage");
}

export async function startMastraServer(): Promise<void> {
  const config = getConfig();
  if (!config.mastra.studioEnabled) {
    logger.info("Mastra Studio disabled");
    return;
  }

  // Import and start the server
  const { createAndStartServer } = await import("./server.js");
  await createAndStartServer(mastra, {
    port: config.mastra.studioPort,
    host: config.mastra.studioHost,
  });
}

// Export routing agent
export { routingAgent, createRoutingAgent } from "./agents/routing-agent.js";

// Export specialized agents
export {
  messagingAgent,
  serverAgent,
  moderationAgent,
  musicAgent,
  automationAgent,
} from "./agents/specialized/index.js";

// Legacy exports (for backwards compatibility)
export {
  createBirmelAgent,
  createBirmelAgentWithContext,
} from "./agents/birmel-agent.js";
export { createClassifierAgent } from "./agents/classifier-agent.js";
export { SYSTEM_PROMPT } from "./agents/system-prompt.js";

// Stylization agent
export { stylizationAgent, createStylizationAgent } from "./agents/stylization-agent.js";

// Workflows
export {
  prepareMessageWorkflow,
  type PrepareMessageInput,
  type PrepareMessageOutput,
} from "./workflows/index.js";
