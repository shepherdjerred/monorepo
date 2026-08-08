import { z } from "zod";

export const FlowScenarioSchema = z.enum([
  "direct",
  "specialist-tool",
  "placeholder-failure",
  "context-failure",
  "router-malformed",
  "specialist-failure",
  "tool-output-failure",
  "final-delivery-failure",
  "dedupe",
  "concurrent-ordering",
  "queued-session-inactive",
  "memory-deletion",
  "agent-run-persistence",
  "session-persistence-failure",
  "agent-run-completion-failure",
]);

export type FlowScenario = z.infer<typeof FlowScenarioSchema>;

export const FlowScenarioResultSchema = z.object({
  scenario: FlowScenarioSchema,
  runStatuses: z.array(z.string()),
  replyCalls: z.number().int().nonnegative(),
  replyPayloads: z.array(z.string()),
  editAttempts: z.array(z.string()),
  deliveredEdits: z.array(z.string()),
  contextCalls: z.number().int().nonnegative(),
  routerCalls: z.number().int().nonnegative(),
  directCalls: z.number().int().nonnegative(),
  specialistCalls: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  memoryExtractionCalls: z.number().int().nonnegative(),
  sessionEventCalls: z.number().int().nonnegative(),
  deliveryOrder: z.array(z.string()),
  incidentIds: z.array(z.string()),
  responseMessageIds: z.array(z.string()),
  errorClasses: z.array(z.string()),
  finishReasons: z.array(z.string()),
  agentRunColumns: z.array(z.string()),
  serializedAgentRuns: z.string(),
  secondReplyObservedWhileFirstBlocked: z.boolean(),
});

export type FlowScenarioResult = z.infer<typeof FlowScenarioResultSchema>;

export const FlowHarnessResultSchema = z.object({
  scenarios: z.array(FlowScenarioResultSchema),
});

export type FlowHarnessResult = z.infer<typeof FlowHarnessResultSchema>;

export const FLOW_RESULT_PREFIX = "BIRMEL_FLOW_RESULT=";
