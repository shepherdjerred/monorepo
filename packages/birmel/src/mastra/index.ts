/**
 * @deprecated This module is deprecated. Use the VoltAgent module instead.
 * Import from "../voltagent/index.js" for the new implementation.
 *
 * This file is kept for backwards compatibility with any code that still
 * references the Mastra agents.
 */

// Re-export VoltAgent components as Mastra-compatible exports
export {
  routingAgent,
  createRoutingAgentWithPersona as createRoutingAgent,
  SYSTEM_PROMPT,
  messagingAgent,
  serverAgent,
  moderationAgent,
  musicAgent,
  automationAgent,
  editorAgent,
} from "../voltagent/index.js";

// Re-export memory functions with legacy names
export {
  getMemory,
  getGlobalThreadId,
  getOwnerThreadId,
  getServerConversationId as getServerThreadId,
  getOwnerConversationId as getOwnerConversationId,
} from "../voltagent/memory/index.js";
