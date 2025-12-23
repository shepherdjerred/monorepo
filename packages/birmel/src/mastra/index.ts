import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { createBirmelAgent } from "./agents/birmel-agent.js";
import { createClassifierAgent } from "./agents/classifier-agent.js";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getMastraObservability } from "./telemetry/index.js";

// Create agents at module load time
const birmelAgent = createBirmelAgent();
const classifierAgent = createClassifierAgent();

const config = getConfig();

/**
 * The main Mastra instance for Birmel.
 * Exported as `mastra` for Mastra CLI compatibility.
 */
export const mastra = new Mastra({
  agents: {
    birmel: birmelAgent,
    classifier: classifierAgent,
  },
  storage: new LibSQLStore({
    url: config.mastra.telemetryDbPath,
  }),
  ...(config.telemetry.enabled ? { observability: getMastraObservability() } : {}),
});

/**
 * @deprecated Use `mastra` directly instead
 */
export function getMastra(): Mastra {
  return mastra;
}

export function getBirmelAgent() {
  return mastra.getAgent("birmel");
}

export function getClassifierAgent() {
  return mastra.getAgent("classifier");
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

export {
  createBirmelAgent,
  createBirmelAgentWithContext,
} from "./agents/birmel-agent.js";
export { createClassifierAgent } from "./agents/classifier-agent.js";
export { SYSTEM_PROMPT } from "./agents/system-prompt.js";
