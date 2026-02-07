// Main exports for VoltAgent migration

// Routing agent and specialized agents
export {
  routingAgent,
  createRoutingAgentWithPersona,
  SYSTEM_PROMPT,
  buildSystemPromptWithPersona,
  messagingAgent,
  serverAgent,
  moderationAgent,
  musicAgent,
  automationAgent,
  editorAgent,
} from "./agents/index.js";

// Memory system
export {
  createMemory,
  getMemory,
  getServerConversationId,
  getOwnerConversationId,
  getChannelConversationId,
  getServerWorkingMemory,
  updateServerWorkingMemory,
  getOwnerWorkingMemory,
  updateOwnerWorkingMemory,
  SERVER_MEMORY_TEMPLATE,
  OWNER_MEMORY_TEMPLATE,
  // Legacy aliases
  getGlobalThreadId,
  getServerThreadId,
  getOwnerThreadId,
} from "./memory/index.js";

// Tool adapter
export { createTool } from "./tools/create-tool.js";
