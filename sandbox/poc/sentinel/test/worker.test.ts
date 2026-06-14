import { describe, it, expect, beforeEach, mock } from "bun:test";
import { setupTestDatabase, testPrisma, cleanupAllTables } from "./helpers.ts";
import { enqueueJob } from "@shepherdjerred/sentinel/queue/index.ts";
import { resetConfig } from "@shepherdjerred/sentinel/config/index.ts";

// Mock result yielded by the agent SDK
const mockResult = {
  type: "result" as const,
  subtype: "success" as const,
  result: "Mock agent completed",
  num_turns: 1,
  total_cost_usd: 0,
  duration_ms: 100,
  usage: {
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  modelUsage: {},
  permission_denials: [],
  is_error: false,
  duration_api_ms: 100,
  stop_reason: null,
  uuid: "mock-uuid",
  session_id: "mock-session",
};

async function* singleTurnQuery() {
  yield mockResult;
}

function mockAssistantMessage(text: string) {
  return {
    type: "assistant" as const,
    message: {
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text }],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  };
}

async function* multiTurnQuery() {
  yield mockAssistantMessage("thinking...");
  yield mockAssistantMessage("still working...");
  yield mockAssistantMessage("done");
  yield { ...mockResult, num_turns: 3 };
}

// Configurable generator factory — tests can swap this to control mock behavior
let queryGenerator: () => AsyncGenerator = singleTurnQuery;

function noop() {
  // intentional no-op for mock
}

// Track SSE events emitted during tests
const sseEvents: Record<string, unknown>[] = [];

// Mock the Agent SDK before importing worker (which imports it)
void mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => queryGenerator(),
}));

// Mock Discord notifications to avoid real Discord calls
void mock.module("@shepherdjerred/sentinel/discord/notifications.ts", () => ({
  sendJobNotification: noop,
}));

// Mock Discord chat to avoid real Discord calls
void mock.module("@shepherdjerred/sentinel/discord/chat.ts", () => ({
  handleDirectMessage: noop,
  sendChatReply: noop,
  updateUserSession: noop,
}));

// Mock SSE to capture emitted events
void mock.module("@shepherdjerred/sentinel/sse/index.ts", () => ({
  emitSSE: (event: Record<string, unknown>) => {
    sseEvents.push(event);
  },
  addSSEListener: noop,
}));

// Import worker after mocks are set up
const { startWorker, stopWorker } =
  await import("@shepherdjerred/sentinel/queue/worker.ts");

await setupTestDatabase();

async function waitForJobStatus(
  jobId: string,
  statuses: string[],
  timeoutMs = 5000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await testPrisma.job.findUnique({ where: { id: jobId } });
    if (job != null && statuses.includes(job.status)) return job.status;
    await new Promise((r) => {
      setTimeout(r, 50);
    });
  }
  throw new Error(
    `Job ${jobId} did not reach status ${statuses.join("|")} within ${String(timeoutMs)}ms`,
  );
}

beforeEach(async () => {
  await cleanupAllTables();
  Bun.env["QUEUE_POLL_INTERVAL_MS"] = "50";
  resetConfig();
  queryGenerator = singleTurnQuery;
  sseEvents.length = 0;
});

describe("worker", () => {
  it("should process an enqueued job to completion", async () => {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Check CI status",
      triggerType: "cron",
      triggerSource: "scheduler",
    });

    startWorker();
    try {
      const status = await waitForJobStatus(job.id, ["completed"], 5000);
      expect(status).toBe("completed");

      const updated = await testPrisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("completed");
    } finally {
      await stopWorker();
    }
  });

  it("should fail a job with an unknown agent", async () => {
    const job = await enqueueJob({
      agent: "nonexistent-agent",
      prompt: "Do something",
      triggerType: "webhook",
      triggerSource: "test",
      maxRetries: 0,
    });

    startWorker();
    try {
      const status = await waitForJobStatus(job.id, ["failed"], 5000);
      expect(status).toBe("failed");

      const updated = await testPrisma.job.findUnique({
        where: { id: job.id },
      });
      expect(updated).not.toBeNull();
      expect(updated!.result).toContain("Unknown agent");
    } finally {
      await stopWorker();
    }
  });

  it("should stop gracefully via stopWorker", async () => {
    startWorker();
    await stopWorker();

    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Should not be processed",
      triggerType: "cron",
      triggerSource: "scheduler",
    });

    await new Promise((r) => {
      setTimeout(r, 200);
    });

    const updated = await testPrisma.job.findUnique({ where: { id: job.id } });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("pending");
  });

  it("should emit progress updates on each agent turn", async () => {
    queryGenerator = multiTurnQuery;

    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt: "Multi-turn job",
      triggerType: "cron",
      triggerSource: "scheduler",
    });

    startWorker();
    try {
      await waitForJobStatus(job.id, ["completed"], 5000);

      // Verify SSE events were emitted for each assistant turn
      const progressEvents = sseEvents.filter(
        (e) => e["type"] === "job:progress",
      );
      expect(progressEvents).toHaveLength(3);
      expect(progressEvents[0]!["turnsUsed"]).toBe(1);
      expect(progressEvents[1]!["turnsUsed"]).toBe(2);
      expect(progressEvents[2]!["turnsUsed"]).toBe(3);
      expect(progressEvents[0]!["jobId"]).toBe(job.id);

      // Verify the session has the final turnsUsed from the result
      const session = await testPrisma.agentSession.findFirst({
        where: { jobId: job.id },
        orderBy: { startedAt: "desc" },
      });
      expect(session).not.toBeNull();
      expect(session!.turnsUsed).toBe(3);
      expect(session!.status).toBe("completed");
    } finally {
      await stopWorker();
    }
  });
});
