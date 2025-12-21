import { Mastra } from "@mastra/core";
import { createBirmelAgent } from "./agents/birmel-agent.js";
import { createClassifierAgent } from "./agents/classifier-agent.js";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

let mastraInstance: Mastra | null = null;

export function getMastra(): Mastra {
  if (!mastraInstance) {
    const birmelAgent = createBirmelAgent();
    const classifierAgent = createClassifierAgent();

    mastraInstance = new Mastra({
      agents: {
        birmel: birmelAgent,
        classifier: classifierAgent,
      },
    });
  }
  return mastraInstance;
}

export function getBirmelAgent() {
  return getMastra().getAgent("birmel");
}

export function getClassifierAgent() {
  return getMastra().getAgent("classifier");
}

export async function startMastraServer(): Promise<void> {
  const config = getConfig();
  if (config.mastra.studioEnabled) {
    // Mastra Studio is started separately via `mastra dev` command
    // For production, we just log that it would be enabled
    logger.info("Mastra Studio enabled", {
      port: config.mastra.studioPort,
      host: config.mastra.studioHost,
    });
  }
}

export { createBirmelAgent } from "./agents/birmel-agent.js";
export { createClassifierAgent } from "./agents/classifier-agent.js";
export { SYSTEM_PROMPT } from "./agents/system-prompt.js";
