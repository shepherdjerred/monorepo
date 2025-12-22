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
    // Use openai.chat() to force Chat Completions API instead of Responses API.
    // The default openai() uses Responses API which has a bug with reasoning
    // items in conversation history causing:
    // "Item of type 'reasoning' was provided without its required following item"
    // See: https://github.com/vercel/ai/issues/7099
    model: openai.chat(config.openai.model),
    tools: allTools,
    memory: createMemory(),
  });
}
