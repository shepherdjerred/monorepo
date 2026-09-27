import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  locateAgentChatRun,
  dispatchPinnedAgentChatTurn,
} from "#lib/agent-chat-receipts.ts";
import type {
  AgentChatReceiptInput,
  AgentChatPinnedTurn,
} from "#shared/agent/agent-chat-receipt.ts";
import {
  AGENT_CHAT_CATALOG_WORKFLOW_ID,
  MAX_AGENT_CHAT_CATALOG_BINDINGS,
  MAX_AGENT_CHAT_CATALOG_ENTRIES,
  MAX_AGENT_CHAT_CATALOG_STATE_BYTES,
  MAX_AGENT_CHAT_PENDING_TURNS,
  agentChatWorkflowId,
  type AgentChatActivities,
  type AgentChatCatalogState,
  type AgentChatConfig,
  type AgentChatDispatchActivities,
  type DispatchScheduledAgentChatTurnInput,
  type AgentChatTurnRequest,
  type AgentChatTurnResult,
  type RunAgentChatTurnInput,
} from "#shared/agent/agent-chat.ts";
import {
  bindAgentChatUpdate,
  getAgentChatCatalogEntryQuery,
  getAgentChatStateQuery,
  recordAgentChatTurnUpdate,
  registerAgentChatUpdate,
  resolveAgentChatBindingQuery,
  runAgentChatTurnUpdate,
} from "#shared/agent/agent-chat-workflow.ts";
import {
  continueAgentChat,
  listAgentChats,
  getAgentChat,
  registerAgentChat,
  resolveAgentChatBinding,
  runAgentChatTurn as submitAgentChatTurn,
} from "#lib/agent-chat-client.ts";
import {
  compactAgentChatCatalogState,
  registerAgentChatCatalogEntry,
} from "./agent-chat-catalog.ts";

const CONFIG: AgentChatConfig = {
  chatId: "chat-workflow-test",
  title: "Durable chat test",
  provider: "codex",
  model: "gpt-5.4",
  origin: { kind: "schedule", scheduleId: "test-schedule" },
  createdAt: "2026-09-14T16:00:00.000Z",
  maxTurnsPerMessage: 8,
};

function request(turnId: string, prompt: string): AgentChatTurnRequest {
  return {
    turnId,
    prompt,
    submittedAt: "2026-09-14T16:01:00.000Z",
    source: { kind: "discord", channelId: "channel-1" },
  };
}

function turnResult(input: RunAgentChatTurnInput): AgentChatTurnResult {
  return {
    turnId: input.request.turnId,
    turnNumber: input.turnNumber,
    finalText: `reply:${input.request.prompt}`,
    providerSessionId: input.providerSessionId ?? "session-1",
    sessionManifestKey: `agent-chats/sessions/${input.config.chatId}/turns/${String(input.turnNumber)}/manifest.json`,
    completedAt: "2026-09-14T16:02:00.000Z",
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
    },
  };
}

async function withWorkers(
  run: (environment: TestWorkflowEnvironment) => Promise<void>,
  overrides: {
    runAgentChatTurn?: AgentChatActivities["runAgentChatTurn"];
    dispatchScheduledAgentChatTurn?: AgentChatDispatchActivities["dispatchScheduledAgentChatTurn"];
  } = {},
): Promise<void> {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const observedTurns: RunAgentChatTurnInput[] = [];
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
  });
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.AGENT_TASK,
    activities: {
      runAgentChatTurn:
        overrides.runAgentChatTurn ??
        ((input) => {
          observedTurns.push(input);
          return turnResult(input);
        }),
    },
  });
  const repoActivityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.AGENT_CHAT_DISPATCH,
    activities: {
      dispatchScheduledAgentChatTurn:
        overrides.dispatchScheduledAgentChatTurn ??
        ((input: DispatchScheduledAgentChatTurnInput) => ({
          turnId: input.request.turnId,
          turnNumber: 1,
          finalText: `scheduled:${input.request.prompt}`,
          providerSessionId: "scheduled-session-1",
          sessionManifestKey:
            "agent-chats/sessions/chat-workflow-test/turns/1/manifest.json",
          completedAt: "2026-09-14T16:02:00.000Z",
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 5,
            reasoningTokens: 0,
          },
        })),
    },
  });
  const activityRun = activityWorker.run();
  const repoActivityRun = repoActivityWorker.run();
  const receiptWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.AGENT_CHAT_RECEIPTS,
    activities: {
      locateAgentChatRun: (input: AgentChatReceiptInput) =>
        locateAgentChatRun(environment.client.workflow, input),
      dispatchPinnedAgentChatTurn: (input: AgentChatPinnedTurn) =>
        dispatchPinnedAgentChatTurn(environment.client.workflow, input),
    },
  });
  const receiptRun = receiptWorker.run();
  try {
    await workflowWorker.runUntil(run(environment));
  } finally {
    activityWorker.shutdown();
    repoActivityWorker.shutdown();
    receiptWorker.shutdown();
    await Promise.all([activityRun, repoActivityRun, receiptRun]);
    await environment.teardown();
  }
}

test("retires the oldest catalog records before payload limits", () => {
  const state: AgentChatCatalogState = {
    schemaVersion: 1,
    entries: [],
    bindings: [],
    retiredChatIds: Array.from(
      { length: MAX_AGENT_CHAT_CATALOG_ENTRIES },
      (_, index) => `retired-${String(index)}`,
    ),
  };
  for (let index = 0; index <= MAX_AGENT_CHAT_CATALOG_ENTRIES; index += 1) {
    const suffix = index.toString().padStart(4, "0");
    const chatId = `chat-${suffix}`;
    const updatedAt =
      index === 0
        ? "2026-01-01T15:00:00Z"
        : index === 1
          ? "2026-01-01T10:00:00-10:00"
          : new Date(Date.UTC(2026, 0, 2) + index * 1000).toISOString();
    state.entries.push({
      schemaVersion: 1,
      config: {
        ...CONFIG,
        chatId,
        title: `Catalog chat ${suffix}`,
        createdAt: updatedAt,
      },
      updatedAt,
      turnCount: index,
    });
    state.bindings.push({
      binding: { kind: "imessage", conversationId: `conversation-${suffix}` },
      chatId,
      updatedAt,
    });
  }

  compactAgentChatCatalogState(state, {
    chatId: `chat-${MAX_AGENT_CHAT_CATALOG_ENTRIES.toString().padStart(4, "0")}`,
  });

  expect(state.entries).toHaveLength(MAX_AGENT_CHAT_CATALOG_ENTRIES);
  expect(state.bindings).toHaveLength(MAX_AGENT_CHAT_CATALOG_BINDINGS);
  expect(
    state.entries.some((entry) => entry.config.chatId === "chat-0000"),
  ).toBe(false);
  expect(
    state.entries.some((entry) => entry.config.chatId === "chat-0001"),
  ).toBe(true);
  expect(state.bindings.some((binding) => binding.chatId === "chat-0000")).toBe(
    false,
  );
  expect(state.retiredChatIds).toContain("chat-0000");
  expect(state.retiredChatIds.length).toBeLessThanOrEqual(
    MAX_AGENT_CHAT_CATALOG_ENTRIES,
  );
  expect(
    registerAgentChatCatalogEntry(state, {
      schemaVersion: 1,
      config: {
        ...CONFIG,
        chatId: "chat-0000",
      },
      updatedAt: "2027-01-01T00:00:00Z",
      turnCount: 0,
    }).config.chatId,
  ).toBe("chat-0000");
  expect(state.retiredChatIds).not.toContain("chat-0000");
  expect(
    new TextEncoder().encode(JSON.stringify(state)).byteLength,
  ).toBeLessThanOrEqual(MAX_AGENT_CHAT_CATALOG_STATE_BYTES);
});

describe("agent chat workflows", () => {
  test("fresh catalogs return empty results and evicted chats retain immutable ownership", async () => {
    await withWorkers(async (environment) => {
      const client = environment.client.workflow;
      expect(await listAgentChats(client)).toEqual([]);
      expect(await getAgentChat(client, CONFIG.chatId)).toBeUndefined();
      expect(
        await resolveAgentChatBinding(client, {
          kind: "discord",
          channelId: "channel-1",
        }),
      ).toBeUndefined();
      const chat = await client.start("agentChatWorkflow", {
        workflowId: agentChatWorkflowId(CONFIG.chatId),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ config: CONFIG }],
      });
      await client.start("agentChatCatalogWorkflow", {
        workflowId: AGENT_CHAT_CATALOG_WORKFLOW_ID,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [
          {
            schemaVersion: 1,
            entries: [],
            bindings: [],
            retiredChatIds: [CONFIG.chatId],
          },
        ],
      });
      await expect(
        registerAgentChat(client, {
          ...CONFIG,
          provider: "claude",
          model: "claude-opus-5",
        }),
      ).rejects.toThrow("immutable configuration");
      const recovered = await getAgentChat(client, CONFIG.chatId);
      expect(recovered?.config).toEqual(CONFIG);
      const result = await continueAgentChat({
        client,
        chatId: CONFIG.chatId,
        request: request("after-eviction", "resume"),
      });
      expect(result.finalText).toBe("reply:resume");
      await chat.terminate("test complete");
    });
  }, 60_000);
  test("serializes resumable turns and deduplicates transport retries", async () => {
    await withWorkers(async (environment) => {
      const firstRequest = request("message-1", "first");
      const first = await submitAgentChatTurn({
        client: environment.client.workflow,
        config: CONFIG,
        request: firstRequest,
      });
      const handle = environment.client.workflow.getHandle(
        agentChatWorkflowId(CONFIG.chatId),
      );
      const duplicate = await handle.executeUpdate(runAgentChatTurnUpdate, {
        args: [firstRequest],
      });
      const second = await continueAgentChat({
        client: environment.client.workflow,
        chatId: CONFIG.chatId,
        request: request("message-2", "second"),
      });
      const state = await handle.query(getAgentChatStateQuery);

      expect(first).toEqual(duplicate);
      expect(second.turnNumber).toBe(2);
      expect(state.providerSessionId).toBe("session-1");
      expect(state.providerSessionManifestKey).toContain("/turns/2/");
      expect(state.nextTurnNumber).toBe(3);
      expect(state.recentTurns).toHaveLength(2);

      await expect(
        handle.executeUpdate(runAgentChatTurnUpdate, {
          args: [request("message-1", "different prompt")],
        }),
      ).rejects.toThrow("Workflow Update failed");
      const stateAfterConflict = await handle.query(getAgentChatStateQuery);
      expect(stateAfterConflict.recentTurns).toHaveLength(2);
      await handle.terminate("test complete");
    });
  }, 60_000);

  test("rejects excess pending turns with explicit backpressure", async () => {
    const firstStarted = Promise.withResolvers<undefined>();
    const releaseFirst = Promise.withResolvers<undefined>();
    let activityCalls = 0;
    await withWorkers(
      async (environment) => {
        const handle = await environment.client.workflow.start(
          "agentChatWorkflow",
          {
            workflowId: `agent-chat-${crypto.randomUUID()}`,
            taskQueue: TASK_QUEUES.WORKFLOWS,
            args: [{ config: CONFIG }],
          },
        );
        const pending = Array.from(
          { length: MAX_AGENT_CHAT_PENDING_TURNS },
          (_, index) =>
            handle.executeUpdate(runAgentChatTurnUpdate, {
              args: [request(`queued-message-${String(index)}`, "queued")],
            }),
        );
        await firstStarted.promise;
        await expect
          .poll(async () => {
            const state = await handle.query(getAgentChatStateQuery);
            return state.queuedTurnIds.length;
          })
          .toBe(MAX_AGENT_CHAT_PENDING_TURNS - 1);
        await expect(
          handle.executeUpdate(runAgentChatTurnUpdate, {
            args: [request("overflow-message", "overflow")],
          }),
        ).rejects.toThrow("Workflow Update failed");
        releaseFirst.resolve(undefined);
        await Promise.all(pending);
        await handle.terminate("test complete");
      },
      {
        runAgentChatTurn: async (input) => {
          activityCalls += 1;
          if (activityCalls === 1) {
            firstStarted.resolve(undefined);
            await releaseFirst.promise;
          }
          return turnResult(input);
        },
      },
    );
  }, 60_000);

  test("bounds retained turn history by serialized payload size", async () => {
    await withWorkers(async (environment) => {
      const handle = await environment.client.workflow.start(
        "agentChatWorkflow",
        {
          workflowId: `agent-chat-${crypto.randomUUID()}`,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ config: CONFIG }],
        },
      );
      const largePrompt = "x".repeat(190_000);
      for (let index = 0; index < 4; index += 1) {
        await handle.executeUpdate(runAgentChatTurnUpdate, {
          args: [request(`large-message-${String(index)}`, largePrompt)],
        });
      }
      const state = await handle.query(getAgentChatStateQuery);

      expect(state.recentTurns.length).toBeLessThan(4);
      expect(
        new TextEncoder().encode(JSON.stringify(state.recentTurns)).byteLength,
      ).toBeLessThanOrEqual(1_000_000);
      await handle.terminate("test complete");
    });
  }, 60_000);
});

describe("agent chat catalog and schedules", () => {
  test("catalogs chats and moves an ingress active binding", async () => {
    await withWorkers(async (environment) => {
      const handle = await environment.client.workflow.start(
        "agentChatCatalogWorkflow",
        {
          workflowId: AGENT_CHAT_CATALOG_WORKFLOW_ID,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [],
        },
      );
      const firstEntry = {
        schemaVersion: 1 as const,
        config: CONFIG,
        updatedAt: "2026-09-14T16:03:00.000Z",
        turnCount: 2,
      };
      const secondEntry = {
        ...firstEntry,
        config: { ...CONFIG, chatId: "chat-workflow-test-2" },
      };
      await handle.executeUpdate(registerAgentChatUpdate, {
        args: [firstEntry],
      });
      await handle.executeUpdate(registerAgentChatUpdate, {
        args: [secondEntry],
      });
      const binding = { kind: "imessage" as const, conversationId: "guid-1" };
      await handle.executeUpdate(bindAgentChatUpdate, {
        args: [binding, CONFIG.chatId, "2026-09-14T16:04:00.000Z"],
      });
      await handle.executeUpdate(bindAgentChatUpdate, {
        args: [binding, secondEntry.config.chatId, "2026-09-14T16:05:00.000Z"],
      });
      await handle.executeUpdate(bindAgentChatUpdate, {
        args: [binding, CONFIG.chatId, "2026-09-14T16:05:00.000Z"],
      });
      await handle.executeUpdate(bindAgentChatUpdate, {
        args: [binding, secondEntry.config.chatId, "2026-09-14T16:04:30.000Z"],
      });
      await handle.executeUpdate(recordAgentChatTurnUpdate, {
        args: [CONFIG.chatId, 3, "2026-09-14T16:06:00.000Z"],
      });
      await handle.executeUpdate(recordAgentChatTurnUpdate, {
        args: [CONFIG.chatId, 2, "2026-09-14T16:05:30.000Z"],
      });

      const entries = await listAgentChats(environment.client.workflow);
      expect(entries).toHaveLength(2);
      const resolved = await handle.query(
        resolveAgentChatBindingQuery,
        binding,
      );
      expect(resolved?.config.chatId).toBe(CONFIG.chatId);
      const updated = await handle.query(
        getAgentChatCatalogEntryQuery,
        CONFIG.chatId,
      );
      expect(updated?.updatedAt).toBe("2026-09-14T16:06:00.000Z");
      expect(updated?.turnCount).toBe(3);
      await handle.terminate("test complete");
    });
  }, 60_000);

  test("dispatches a scheduled occurrence through the normal chat request", async () => {
    await withWorkers(async (environment) => {
      const result = await environment.client.workflow.execute(
        "scheduledAgentChatTurnWorkflow",
        {
          workflowId: `scheduled-agent-chat-${crypto.randomUUID()}`,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [
            {
              config: CONFIG,
              prompt: "scheduled prompt",
              scheduleId: "test-schedule",
            },
          ],
        },
      );
      expect(result.finalText).toBe("scheduled:scheduled prompt");
      expect(result.turnId).toMatch(/[a-f\d-]{36}/);
    });
  }, 60_000);

  test("retries an idempotent scheduled dispatch", async () => {
    let attempts = 0;
    await withWorkers(
      async (environment) => {
        const result = await environment.client.workflow.execute(
          "scheduledAgentChatTurnWorkflow",
          {
            workflowId: `scheduled-agent-chat-${crypto.randomUUID()}`,
            taskQueue: TASK_QUEUES.WORKFLOWS,
            args: [
              {
                config: CONFIG,
                prompt: "retry scheduled prompt",
                scheduleId: "test-schedule",
              },
            ],
          },
        );
        expect(result.finalText).toBe("scheduled:retry scheduled prompt");
        expect(attempts).toBe(2);
      },
      {
        dispatchScheduledAgentChatTurn: (input) => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient dispatch failure");
          return Promise.resolve({
            turnId: input.request.turnId,
            turnNumber: 1,
            finalText: `scheduled:${input.request.prompt}`,
            providerSessionId: "scheduled-session-1",
            sessionManifestKey:
              "agent-chats/sessions/chat-workflow-test/turns/1/manifest.json",
            completedAt: "2026-09-14T16:02:00.000Z",
            usage: {
              inputTokens: 10,
              cachedInputTokens: 0,
              cacheWriteInputTokens: 0,
              outputTokens: 5,
              reasoningTokens: 0,
            },
          });
        },
      },
    );
  }, 60_000);
});
