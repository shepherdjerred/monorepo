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
    // Use CoreSystemMessage format to include providerOptions
    // This fixes the OpenAI Responses API error:
    // "Item of type 'reasoning' was provided without its required following item"
    // See: https://github.com/mastra-ai/mastra/issues/10981
    instructions: {
      role: "system",
      content: SYSTEM_PROMPT,
      providerOptions: {
        openai: {
          // Disable storing conversation in OpenAI's storage
          // This prevents the reasoning item reconstruction issue
          store: false,
          // Include encrypted reasoning content for stateless operation
          include: ["reasoning.encrypted_content"],
        },
      },
    },
    model: openai(config.openai.model),
    tools: allTools,
    memory: createMemory(),
  });
}
