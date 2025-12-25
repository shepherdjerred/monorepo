// Routing agent for Agent Networks
export { routingAgent, createRoutingAgent } from "./routing-agent.js";

// Specialized sub-agents
export {
  messagingAgent,
  serverAgent,
  moderationAgent,
  musicAgent,
  automationAgent,
} from "./specialized/index.js";

// Legacy exports (for backwards compatibility)
export {
  createBirmelAgent,
  createBirmelAgentWithContext,
  classifyMessage,
  detectMultiAgentNeed,
  getAgentDescription,
  type AgentType,
} from "./birmel-agent.js";

export {
  createClassifierAgent,
  parseClassificationResult,
  type ClassificationResult,
} from "./classifier-agent.js";

export { SYSTEM_PROMPT } from "./system-prompt.js";
