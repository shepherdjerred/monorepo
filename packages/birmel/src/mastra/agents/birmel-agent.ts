import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { getConfig } from "../../config/index.js";
import { allTools } from "../tools/index.js";

export function createBirmelAgent(): Agent {
  const config = getConfig();

  return new Agent({
    name: "Birmel",
    instructions: SYSTEM_PROMPT,
    model: anthropic(config.anthropic.model),
    tools: allTools,
  });
}
