import { Mastra } from "@mastra/core";
import { createBirmelAgent } from "./agents/birmel-agent.js";
import { createClassifierAgent } from "./agents/classifier-agent.js";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

// Create agents at module load time
const birmelAgent = createBirmelAgent();
const classifierAgent = createClassifierAgent();

/**
 * The main Mastra instance for Birmel.
 * Exported as `mastra` for Mastra CLI compatibility.
 */
export const mastra = new Mastra({
  agents: {
    birmel: birmelAgent,
    classifier: classifierAgent,
  },
  server: {
    port: getConfig().mastra.studioPort,
  },
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

export function startMastraServer(): void {
  const config = getConfig();
  if (config.mastra.studioEnabled) {
    // Mastra Studio is started separately via `mastra dev` or `mastra start`
    logger.info("Mastra Studio enabled", {
      port: config.mastra.studioPort,
      host: config.mastra.studioHost,
    });
  }
}

export {
  createBirmelAgent,
  createBirmelAgentWithContext,
} from "./agents/birmel-agent.js";
export { createClassifierAgent } from "./agents/classifier-agent.js";
export { SYSTEM_PROMPT } from "./agents/system-prompt.js";
