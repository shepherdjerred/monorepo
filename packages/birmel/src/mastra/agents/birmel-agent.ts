import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { getConfig } from "../../config/index.js";
import { createMemory } from "../memory/index.js";
import {
  buildDecisionContext,
  formatDecisionPrompt,
} from "../../persona/index.js";
import { getGuildPersona } from "../../persona/guild-persona.js";
import {
  type AgentType,
  getToolSet,
  toolsToRecord,
} from "../tools/tool-sets.js";
import { classifyMessage, getAgentDescription } from "./message-classifier.js";
import { logger } from "../../utils/index.js";

/**
 * Create a specialized Birmel agent with tools appropriate for the message content.
 * Uses keyword classification to select the right tool set.
 */
export function createBirmelAgent(
  messageContent?: string,
  agentType?: AgentType,
): Agent {
  const config = getConfig();

  // Determine agent type from message content or use provided type
  const type = agentType ?? (messageContent ? classifyMessage(messageContent) : "general");
  const tools = getToolSet(type);
  const toolsRecord = toolsToRecord(tools);

  logger.debug("Creating specialized agent", {
    agentType: type,
    toolCount: tools.length,
    description: getAgentDescription(type),
  });

  return new Agent({
    id: `birmel-${type}`,
    name: "Birmel",
    instructions: SYSTEM_PROMPT,
    // Use openai.chat() to force Chat Completions API instead of Responses API.
    // The default openai() uses Responses API which has a bug with reasoning
    // items in conversation history causing:
    // "Item of type 'reasoning' was provided without its required following item"
    // See: https://github.com/vercel/ai/issues/7099
    model: openai.chat(config.openai.model),
    tools: toolsRecord as ToolsInput,
    memory: createMemory(),
  });
}

/**
 * Create a Birmel agent with persona context and specialized tools.
 */
export async function createBirmelAgentWithContext(
  userQuery: string,
  guildId: string,
  agentType?: AgentType,
): Promise<Agent> {
  const config = getConfig();

  // Determine agent type from message content or use provided type
  const type = agentType ?? classifyMessage(userQuery);
  const tools = getToolSet(type);
  const toolsRecord = toolsToRecord(tools);

  logger.debug("Creating specialized agent with context", {
    agentType: type,
    toolCount: tools.length,
    description: getAgentDescription(type),
    guildId,
  });

  // Get guild-specific persona
  const persona = await getGuildPersona(guildId);

  // Build decision context from persona's similar messages
  const decisionContext = buildDecisionContext(persona, userQuery);

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
    id: `birmel-${type}-with-context`,
    name: "Birmel",
    instructions: enhancedPrompt,
    // Use openai.chat() to force Chat Completions API instead of Responses API.
    // The default openai() uses Responses API which has a bug with reasoning
    // items in conversation history causing:
    // "Item of type 'reasoning' was provided without its required following item"
    // See: https://github.com/vercel/ai/issues/7099
    model: openai.chat(config.openai.model),
    tools: toolsRecord as ToolsInput,
    memory: createMemory(),
  });
}

// Re-export types and utilities for convenience
export { classifyMessage, getAgentDescription } from "./message-classifier.js";
export type { AgentType } from "../tools/tool-sets.js";
