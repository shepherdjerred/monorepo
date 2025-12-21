import { Mastra } from "@mastra/core";
import { createBirmelAgent } from "./agents/index.js";

let mastraInstance: Mastra | null = null;

export function getMastra(): Mastra {
  if (!mastraInstance) {
    const birmelAgent = createBirmelAgent();
    mastraInstance = new Mastra({
      agents: { birmel: birmelAgent },
    });
  }
  return mastraInstance;
}

export function getBirmelAgent() {
  return getMastra().getAgent("birmel");
}

export { createBirmelAgent, SYSTEM_PROMPT } from "./agents/index.js";
