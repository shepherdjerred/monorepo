import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { getConfig } from "../../config/index.js";
import { allTools } from "../tools/index.js";
import { createMemory } from "../memory/index.js";

export function createBirmelAgent(): Agent {
  const config = getConfig();

  return new Agent({
    id: "birmel",
    name: "Birmel",
    instructions: SYSTEM_PROMPT,
    model: openai(config.openai.model),
    tools: allTools,
    memory: createMemory(),
  });
}
