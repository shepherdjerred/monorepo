import { AgentType } from '@clauderon/shared';

export type AgentFeature = {
  name: string;
  supported: boolean;
  note?: string;
}

export type AgentCapabilities = {
  displayName: string;
  features: AgentFeature[];
}

export const AGENT_CAPABILITIES: Record<AgentType, AgentCapabilities> = {
  [AgentType.ClaudeCode]: {
    displayName: 'Claude Code',
    features: [
      { name: 'Real-time state detection', supported: true },
      { name: 'Session ID support', supported: true },
      { name: 'Image/screenshot support', supported: true },
      { name: 'Permissions bypass mode', supported: true },
    ],
  },
  [AgentType.Codex]: {
    displayName: 'Codex',
    features: [
      { name: 'Real-time state detection', supported: true },
      { name: 'Session ID support', supported: true },
      { name: 'Image/screenshot support', supported: true },
      { name: 'Permissions bypass mode', supported: true },
    ],
  },
  [AgentType.Gemini]: {
    displayName: 'Gemini Code',
    features: [
      { name: 'Real-time state detection', supported: true },
      { name: 'Session ID support', supported: true },
      { name: 'Image/screenshot support', supported: true },
      { name: 'Permissions bypass mode', supported: true },
    ],
  },
};

/**
 * Get capabilities for a given agent type
 */
export function getAgentCapabilities(agentType: AgentType): AgentCapabilities {
  return AGENT_CAPABILITIES[agentType];
}

/**
 * Check if an agent supports a specific feature
 */
export function agentSupportsFeature(
  agentType: AgentType,
  featureName: string
): boolean {
  const capabilities = AGENT_CAPABILITIES[agentType];
  const feature = capabilities.features.find(f => f.name === featureName);
  return feature?.supported ?? false;
}

/**
 * Get available agent types based on feature flags
 */
export function getAvailableAgents(enableExperimental: boolean): AgentType[] {
  const agents = [AgentType.ClaudeCode];

  if (enableExperimental) {
    agents.push(AgentType.Codex, AgentType.Gemini);
  }

  return agents;
}

/**
 * Check if an agent is experimental
 */
export function isExperimentalAgent(agentType: AgentType): boolean {
  return agentType === AgentType.Codex || agentType === AgentType.Gemini;
}
