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
  getAgentDescription,
  toolsToRecord,
} from "../tools/tool-sets.js";
import { classifyMessage, detectMultiAgentNeed } from "./message-classifier.js";
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
  const type = agentType ?? (messageContent ? classifyMessage(messageContent) : "messaging");
  const tools = getToolSet(type);
  const toolsRecord = toolsToRecord(tools);

  // Log if multiple agents might be needed
  if (messageContent) {
    const neededAgents = detectMultiAgentNeed(messageContent);
    if (neededAgents.length > 1) {
      logger.debug("Message may span multiple agent domains", {
        selectedAgent: type,
        allDetected: neededAgents,
      });
    }
  }

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

  // Log if multiple agents might be needed
  const neededAgents = detectMultiAgentNeed(userQuery);
  if (neededAgents.length > 1) {
    logger.debug("Message may span multiple agent domains", {
      selectedAgent: type,
      allDetected: neededAgents,
      guildId,
    });
  }

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
      const insertPoint = SYSTEM_PROMPT.indexOf("## Ethical Guidelines");
      if (insertPoint !== -1) {
        enhancedPrompt =
          SYSTEM_PROMPT.slice(0, insertPoint) +
          decisionPrompt +
          "\n" +
          SYSTEM_PROMPT.slice(insertPoint);
      } else {
        enhancedPrompt = SYSTEM_PROMPT + "\n" + decisionPrompt;
      }
    }
  }

  return new Agent({
    id: `birmel-${type}-with-context`,
    name: "Birmel",
    instructions: enhancedPrompt,
    model: openai.chat(config.openai.model),
    tools: toolsRecord as ToolsInput,
    memory: createMemory(),
  });
}

// Re-export types and utilities
export { classifyMessage, detectMultiAgentNeed } from "./message-classifier.js";
export { getAgentDescription } from "../tools/tool-sets.js";
export type { AgentType } from "../tools/tool-sets.js";
