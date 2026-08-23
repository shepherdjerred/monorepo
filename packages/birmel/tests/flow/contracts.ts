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
  "memory-extraction-failure",
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
  memoryExtractionErrors: z.number().int().nonnegative(),
  sessionEventCalls: z.number().int().nonnegative(),
  deliveryOrder: z.array(z.string()),
  incidentIds: z.array(z.string()),
  responseMessageIds: z.array(z.string()),
  errorClasses: z.array(z.string()),
  finishReasons: z.array(z.string()),
  routeDispositions: z.array(z.string().nullable()),
  primaryToolIds: z.array(z.string().nullable()),
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

// The harness runs every scenario in FlowScenarioSchema — migrations, Prisma,
// and a full turn each — inside one vitest test, so it must not inherit
// vitest's 5s default. Build 10975 timed out at 5111ms against a ~430ms idle
// run: a loaded CI agent is an order of magnitude slower, not a few percent.
export const FLOW_HARNESS_TEST_TIMEOUT_MS = 20_000;

// turn-flow.test.ts spawns the harness as a child vitest run, so its budget has
// to outlast the harness test itself plus the child's start-up and teardown.
// Deriving it here keeps the two from contradicting each other: the previous
// 30s parent budget sat above a 5s inner default, so the inner test failed
// first and the outer number looked generous while proving nothing.
export const FLOW_HARNESS_CHILD_TIMEOUT_MS =
  FLOW_HARNESS_TEST_TIMEOUT_MS + 20_000;
