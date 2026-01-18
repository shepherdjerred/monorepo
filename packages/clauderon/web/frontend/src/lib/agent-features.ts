import { AgentType } from '@clauderon/shared';

export interface AgentFeature {
  name: string;
  supported: boolean;
  note?: string;
}

export interface AgentCapabilities {
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
