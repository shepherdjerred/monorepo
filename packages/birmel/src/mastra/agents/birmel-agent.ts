import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { getConfig } from "../../config/index.js";
import { allTools } from "../tools/index.js";
import { createMemory } from "../memory/index.js";
import {
  buildDecisionContext,
  formatDecisionPrompt,
} from "../../persona/index.js";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: allTools as any,
    memory: createMemory(),
  });
}

export function createBirmelAgentWithContext(userQuery: string): Agent {
  const config = getConfig();

  // Build decision context from persona's similar messages
  const decisionContext = buildDecisionContext(
    config.persona.defaultPersona,
    userQuery,
  );

  // Create enhanced system prompt with decision guidance
  let enhancedPrompt = SYSTEM_PROMPT;
  if (decisionContext) {
    const decisionPrompt = formatDecisionPrompt(decisionContext);
    if (decisionPrompt) {
      // Insert decision guidance after the personality section
      const insertPoint = SYSTEM_PROMPT.indexOf("## Ethical Guidelines");
      if (insertPoint !== -1) {
        enhancedPrompt =
          SYSTEM_PROMPT.slice(0, insertPoint) +
          decisionPrompt +
          "\n" +
          SYSTEM_PROMPT.slice(insertPoint);
      } else {
        // Fallback: append to end
        enhancedPrompt = SYSTEM_PROMPT + "\n" + decisionPrompt;
      }
    }
  }

  return new Agent({
    id: "birmel-with-context",
    name: "Birmel",
    instructions: enhancedPrompt,
    // Use openai.chat() to force Chat Completions API instead of Responses API.
    // The default openai() uses Responses API which has a bug with reasoning
    // items in conversation history causing:
    // "Item of type 'reasoning' was provided without its required following item"
    // See: https://github.com/vercel/ai/issues/7099
    model: openai.chat(config.openai.model),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: allTools as any,
    memory: createMemory(),
  });
}
