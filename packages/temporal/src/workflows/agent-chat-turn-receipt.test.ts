import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure } from "@temporalio/common";
import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  AGENT_CHAT_DISPATCH_MAX_ATTEMPTS,
  agentChatWorkflowId,
  type AgentChatConfig,
  type AgentChatTurnRequest,
  type AgentChatTurnResult,
  type RunAgentChatTurnInput,
  type AgentChatWorkflowState,
} from "#shared/agent/agent-chat.ts";
import {
  getAgentChatStateQuery,
  runAgentChatTurnUpdate,
} from "#shared/agent/agent-chat-workflow.ts";
import type {
  AgentChatReceiptInput,
  AgentChatPinnedTurn,
  AgentChatPinnedResult,
} from "#shared/agent/agent-chat-receipt.ts";
import {
  agentChatReceiptWorkflowId,
  dispatchPinnedAgentChatTurn,
  locateAgentChatRun,
} from "#lib/agent-chat-receipts.ts";
import { runAgentChatTurn } from "#lib/agent-chat-client.ts";
import { rolloverChatFixtureSignal } from "./replay-fixtures/agent-chat-receipt.ts";

const CONFIG: AgentChatConfig = {
  chatId: "receipt-test",
  title: "Receipt test",
  provider: "codex",
  model: "gpt-5.4",
  origin: { kind: "schedule", scheduleId: "test-schedule" },
  createdAt: "2026-09-14T16:00:00.000Z",
  maxTurnsPerMessage: 8,
};
function request(turnId: string): AgentChatTurnRequest {
  return {
    turnId,
    prompt: `prompt:${turnId}`,
    submittedAt: "2026-09-14T16:01:00.000Z",
    source: { kind: "schedule", scheduleId: "test-schedule" },
  };
}
function result(input: RunAgentChatTurnInput): AgentChatTurnResult {
  return {
    turnId: input.request.turnId,
    turnNumber: input.turnNumber,
    finalText: `reply:${input.request.turnId}`,
    providerSessionId: "session",
    sessionManifestKey: `manifest/${String(input.turnNumber)}`,
    completedAt: "2026-09-14T16:02:00.000Z",
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
    },
  };
}

async function withWorkers(
  verify: (env: TestWorkflowEnvironment) => Promise<void>,
  overrides: {
    runTurn?: (input: RunAgentChatTurnInput) => AgentChatTurnResult;
    dispatch?: (
      env: TestWorkflowEnvironment,
      input: AgentChatPinnedTurn,
    ) => Promise<AgentChatPinnedResult>;
  },
) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const workflowWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: new URL(
      "replay-fixtures/agent-chat-receipt.ts",
      import.meta.url,
    ).pathname,
  });
  const agentWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUES.AGENT_TASK,
    activities: { runAgentChatTurn: overrides.runTurn ?? result },
  });
  const receiptWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUES.AGENT_CHAT_RECEIPTS,
    activities: {
      locateAgentChatRun: (input: AgentChatReceiptInput) =>
        locateAgentChatRun(env.client.workflow, input),
      dispatchPinnedAgentChatTurn: (input: AgentChatPinnedTurn) =>
        overrides.dispatch === undefined
          ? dispatchPinnedAgentChatTurn(env.client.workflow, input)
          : overrides.dispatch(env, input),
    },
  });
  const runs = [agentWorker.run(), receiptWorker.run()];
  try {
    await workflowWorker.runUntil(verify(env));
  } finally {
    agentWorker.shutdown();
    receiptWorker.shutdown();
    await Promise.all(runs);
    await env.teardown();
  }
}

async function rollover(
  env: TestWorkflowEnvironment,
  state: AgentChatWorkflowState,
) {
  const chat = env.client.workflow.getHandle(
    agentChatWorkflowId(CONFIG.chatId),
  );
  const previous = await chat.describe();
  await chat.signal(rolloverChatFixtureSignal, {
    config: CONFIG,
    restoredState: state,
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await chat.describe();
    if (current.runId !== previous.runId) return;
    await env.sleep(10);
  }
  throw new Error("Chat did not roll over");
}

async function compactLedger(env: TestWorkflowEnvironment) {
  const chat = env.client.workflow.getHandle(
    agentChatWorkflowId(CONFIG.chatId),
  );
  for (let index = 0; index < 100; index += 1) {
    await chat.executeUpdate(runAgentChatTurnUpdate, {
      args: [request(`later-${String(index)}`)],
    });
  }
  const state = await chat.query(getAgentChatStateQuery);
  expect(state.recentTurns).toHaveLength(100);
  expect(
    state.recentTurns.some((turn) => turn.request.turnId === "original"),
  ).toBe(false);
  return state;
}

async function runOriginalTurn(env: TestWorkflowEnvironment) {
  return await runAgentChatTurn({
    client: env.client.workflow,
    config: CONFIG,
    request: request("original"),
  });
}

describe("durable chat turn receipts", () => {
  test("retries after ledger compaction and rollover return the original result without new effects", async () => {
    let calls = 0;
    await withWorkers(
      async (env) => {
        const input = {
          client: env.client.workflow,
          config: CONFIG,
          request: request("original"),
        };
        const first = await runAgentChatTurn(input);
        const state = await compactLedger(env);
        await rollover(env, state);
        expect(await runAgentChatTurn(input)).toEqual(first);
        expect(calls).toBe(101);
        await expect(
          runAgentChatTurn({
            ...input,
            request: { ...input.request, prompt: "different" },
          }),
        ).rejects.toThrow("different request");
        expect(calls).toBe(101);
        const receipt = env.client.workflow.getHandle(
          agentChatReceiptWorkflowId(CONFIG.chatId, "original"),
        );
        const history = await receipt.fetchHistory();
        await Worker.runReplayHistory(
          { workflowsPath: new URL("index.ts", import.meta.url).pathname },
          history,
        );
      },
      {
        runTurn: (input) => {
          calls += 1;
          return result(input);
        },
      },
    );
  }, 60_000);

  test("an ambiguous dispatch retry retains its original run pin across compaction and rollover", async () => {
    let calls = 0;
    const pins: string[] = [];
    await withWorkers(
      async (env) => {
        const outcome = await runOriginalTurn(env);
        expect(outcome.turnNumber).toBe(1);
        expect(calls).toBe(101);
        expect(pins).toHaveLength(2);
        expect(pins[0]).toBe(pins[1]);
      },
      {
        runTurn: (input) => {
          calls += 1;
          return result(input);
        },
        dispatch: async (env, input) => {
          pins.push(input.runId);
          const outcome = await dispatchPinnedAgentChatTurn(
            env.client.workflow,
            input,
          );
          if (pins.length === 1) {
            await rollover(env, await compactLedger(env));
            throw new Error("Simulated lost dispatch result");
          }
          return outcome;
        },
      },
    );
  }, 60_000);

  test("redirects to a new run only when the old pin closed without admitting the turn", async () => {
    let calls = 0;
    const pins: string[] = [];
    await withWorkers(
      async (env) => {
        const outcome = await runOriginalTurn(env);
        expect(outcome.turnNumber).toBe(1);
        expect(calls).toBe(1);
        expect(pins).toHaveLength(2);
        expect(pins[0]).not.toBe(pins[1]);
      },
      {
        runTurn: (input) => {
          calls += 1;
          return result(input);
        },
        dispatch: async (env, input) => {
          pins.push(input.runId);
          if (pins.length === 1) {
            const state = await env.client.workflow
              .getHandle(agentChatWorkflowId(CONFIG.chatId))
              .query(getAgentChatStateQuery);
            await rollover(env, state);
          }
          return dispatchPinnedAgentChatTurn(env.client.workflow, input);
        },
      },
    );
  }, 60_000);

  test("retries transient dispatch exhaustion without sealing the receipt", async () => {
    let dispatchAttempts = 0;
    await withWorkers(
      async (env) => {
        expect(await runOriginalTurn(env)).toMatchObject({ turnNumber: 1 });
        expect(dispatchAttempts).toBe(AGENT_CHAT_DISPATCH_MAX_ATTEMPTS + 1);
      },
      {
        dispatch: async (env, input) => {
          dispatchAttempts += 1;
          if (dispatchAttempts <= AGENT_CHAT_DISPATCH_MAX_ATTEMPTS) {
            throw new Error("Transient receipt transport failure");
          }
          return dispatchPinnedAgentChatTurn(env.client.workflow, input);
        },
      },
    );
  }, 60_000);

  test("settled failures remain terminal after the chat forgets their ledger entry", async () => {
    let calls = 0;
    await withWorkers(
      async (env) => {
        const input = {
          client: env.client.workflow,
          config: CONFIG,
          request: request("original"),
        };
        await expect(runAgentChatTurn(input)).rejects.toThrow(
          "Workflow Update failed",
        );
        const state = await env.client.workflow
          .getHandle(agentChatWorkflowId(CONFIG.chatId))
          .query(getAgentChatStateQuery);
        await rollover(env, { ...state, recentTurns: [] });
        await expect(runAgentChatTurn(input)).rejects.toThrow(
          "Workflow Update failed",
        );
        expect(calls).toBe(1);
      },
      {
        runTurn: () => {
          calls += 1;
          throw ApplicationFailure.nonRetryable("weekly limit", "AuthQuota");
        },
      },
    );
  }, 60_000);
});
