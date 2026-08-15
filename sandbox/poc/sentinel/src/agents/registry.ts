import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";
import { ciFixerAgent } from "./ci-fixer.ts";
import { healthCheckerAgent } from "./health-checker.ts";
import { personalAssistantAgent } from "./personal-assistant.ts";

export const agentRegistry = new Map<string, AgentDefinition>([
  [ciFixerAgent.name, ciFixerAgent],
  [healthCheckerAgent.name, healthCheckerAgent],
  [personalAssistantAgent.name, personalAssistantAgent],
]);

export function getAgent(name: string): AgentDefinition | undefined {
  return agentRegistry.get(name);
}
