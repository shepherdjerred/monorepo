import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";
import { ciFixerAgent } from "./ci-fixer.ts";
import { healthCheckerAgent } from "./health-checker.ts";
import { pdTriagerAgent } from "./pd-triager.ts";

export const agentRegistry = new Map<string, AgentDefinition>([
  [ciFixerAgent.name, ciFixerAgent],
  [healthCheckerAgent.name, healthCheckerAgent],
  [pdTriagerAgent.name, pdTriagerAgent],
]);

export function getAgent(name: string): AgentDefinition | undefined {
  return agentRegistry.get(name);
}
