import { once } from "node:events";
import { ApplicationFailure } from "@temporalio/common";
import { temporalWorkflowTracingModulePath } from "@shepherdjerred/temporal-observability/interceptors";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import {
  bundleWorkflowCode,
  Worker,
  type WorkflowBundle,
} from "@temporalio/worker";
import { beforeAll, describe, expect, test } from "vitest";
import { admitPhotonMessage } from "#lib/photon/admission.ts";
import {
  photonEnvelope,
  PHOTON_NOW,
} from "#lib/photon/fixtures.test-support.ts";
import { normalizePhotonMessage } from "#lib/photon/messages.ts";
import {
  admitPhotonMessageUpdate,
  PhotonCommandSchema,
  PhotonConversationStateSchema,
  photonCommandWorkflowId,
  photonConversationStateQuery,
  photonConversationWorkflowId,
  type PhotonCommand,
  type PhotonDelivery,
  type PhotonMessage,
} from "#shared/agent/agent-chat-photon.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
let workflowBundle: WorkflowBundle;
beforeAll(async () => {
  workflowBundle = await bundleWorkflowCode({ workflowsPath });
}, 60_000);
function message(id: string, timestamp = PHOTON_NOW): PhotonMessage {
  const envelope = photonEnvelope("/help", id);
  envelope.message.timestamp = timestamp;
  const normalized = normalizePhotonMessage(
    envelope,
    "project",
    ["+15550000001"],
    PHOTON_NOW,
  );
  if (normalized === undefined) throw new Error("Fixture did not normalize");
  return normalized;
}
async function replay(
  env: TestWorkflowEnvironment,
  workflowId: string,
  runId?: string,
) {
  await Worker.runReplayHistory(
    { workflowBundle },
    await env.client.workflow.getHandle(workflowId, runId).fetchHistory(),
  );
}
describe("Photon durable conversation and delivery", () => {
  test.each(["success", "provider-failure", "delivery-failure", "help"])(
    "checkpoints results with one delivery attempt: %s",
    async (scenario) => {
      const env = await TestWorkflowEnvironment.createTimeSkipping();
      const command = PhotonCommandSchema.parse({
        ...message(crypto.randomUUID()),
        sourceSequence: 1,
        sourceEpoch: 1,
        outOfOrder: false,
      });
      let executions = 0;
      const delivered: PhotonDelivery[] = [];
      const activityWorker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUES.AGENT_CHAT_PHOTON,
        activities: {
          preparePhotonCommand: () =>
            scenario === "help"
              ? { kind: "message", content: "help" }
              : {
                  kind: "turn",
                  command: {
                    kind: "continue",
                    chatId: "previous-chat",
                    request: {
                      turnId: "photon-turn",
                      prompt: "continue",
                      submittedAt: PHOTON_NOW,
                      source: {
                        kind: "imessage",
                        conversationId: command.conversationId,
                      },
                    },
                  },
                },
          deliverPhotonResponse: (input: PhotonDelivery) => {
            delivered.push(input);
            if (scenario === "delivery-failure")
              throw new Error("ambiguous external send");
            return { messageId: "outgoing-receipt" };
          },
        },
      });
      const inferenceWorker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
        activities: {
          executeHttpAgentChatCommand: () => {
            executions += 1;
            if (scenario === "provider-failure")
              throw ApplicationFailure.nonRetryable(
                "quota",
                "AgentChatTurnFailed",
              );
            return {
              turnId: "photon-turn",
              turnNumber: 1,
              finalText: "durable answer",
              providerSessionId: "session",
              sessionManifestKey: "manifest",
              completedAt: PHOTON_NOW,
              usage: {
                inputTokens: 1,
                cachedInputTokens: 0,
                cacheWriteInputTokens: 0,
                outputTokens: 1,
                reasoningTokens: 0,
              },
            };
          },
        },
      });
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowBundle,
      });
      const activities = [activityWorker.run(), inferenceWorker.run()];
      const workflowId = photonCommandWorkflowId(command.messageId);
      try {
        const execution = worker.runUntil(
          env.client.workflow.execute("photonAgentChatWorkflow", {
            workflowId,
            taskQueue: TASK_QUEUES.WORKFLOWS,
            args: [command],
          }),
        );
        if (scenario === "delivery-failure")
          await expect(execution).rejects.toThrow();
        else await execution;
        expect(executions).toBe(scenario === "help" ? 0 : 1);
        expect(delivered).toHaveLength(1);
        expect(delivered[0]).toMatchObject({
          spaceId: command.spaceId,
          linePhone: command.linePhone,
          content:
            scenario === "help"
              ? "help"
              : scenario === "provider-failure"
                ? expect.stringContaining("will not automatically repeat")
                : "durable answer",
        });
        const history = await env.client.workflow
          .getHandle(workflowId)
          .fetchHistory();
        const schedule = history.events?.find(
          (event) =>
            event.activityTaskScheduledEventAttributes?.activityType?.name ===
            "deliverPhotonResponse",
        );
        expect(
          schedule?.activityTaskScheduledEventAttributes?.retryPolicy
            ?.maximumAttempts,
        ).toBe(1);
        await replay(env, workflowId);
      } finally {
        activityWorker.shutdown();
        inferenceWorker.shutdown();
        await Promise.all(activities);
        await env.teardown();
      }
    },
    60_000,
  );
});
describe("Photon durable conversation admission", () => {
  test("serializes commands, durably rejects conflicts/full queues, and resumes pending admission after a worker restart", async ({
    signal,
  }) => {
    // Exercise poller restarts against the current full Temporal server.
    const { createLeasedLocalTemporalEnvironment } =
      await import("#lib/fixtures/temporal-lease.ts");
    const env = await createLeasedLocalTemporalEnvironment();
    const first = message("first");
    const last = message("pending-49");
    const backlog = [
      message("late", "2026-10-03T11:59:59.000Z"),
      ...Array.from({ length: 47 }, (_, index) =>
        message(`pending-${String(index + 2)}`),
      ),
      last,
    ];
    const workflowId = photonConversationWorkflowId(first.conversationId);
    const prepared: PhotonCommand[] = [];
    const release = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const delivered: string[] = [];
    const delivery = new EventTarget();
    const activityWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_PHOTON,
      activities: {
        preparePhotonCommand: (input: PhotonCommand) => {
          prepared.push(input);
          return { kind: "message", content: input.messageId };
        },
        deliverPhotonResponse: async (input: PhotonDelivery) => {
          if (input.messageId === first.messageId) {
            entered.resolve(undefined);
            await release.promise;
          }
          delivered.push(input.messageId);
          if (input.messageId === last.messageId)
            delivery.dispatchEvent(new Event("last-delivery"));
          return { messageId: "outgoing" };
        },
      },
    });
    const runningActivities = activityWorker.run();
    const firstWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowBundle,
    });
    try {
      await firstWorker.runUntil(async () => {
        expect(
          await admitPhotonMessage(env.client.workflow, first),
        ).toMatchObject({ status: "accepted" });
        await entered.promise;
        // A different update ID reaches the durable ledger instead of the result cache.
        const handle = env.client.workflow.getHandle(workflowId);
        expect(
          await handle.executeUpdate("admitPhotonMessage", { args: [first] }),
        ).toMatchObject({ status: "duplicate" });
        await expect(
          admitPhotonMessage(env.client.workflow, {
            ...first,
            fingerprint: "b".repeat(64),
          }),
        ).rejects.toMatchObject({ cause: { type: "PhotonMessageConflict" } });
        for (const pending of backlog)
          await admitPhotonMessage(env.client.workflow, pending);
        await expect(
          admitPhotonMessage(env.client.workflow, message("overflow")),
        ).rejects.toMatchObject({ cause: { type: "PhotonQueueFull" } });
        const state = PhotonConversationStateSchema.parse(
          await handle.query(photonConversationStateQuery),
        );
        expect(state.pending).toHaveLength(50);
        expect(state.pending[1]).toMatchObject({
          outOfOrder: true,
          sourceSequence: 2,
        });
        expect(prepared).toHaveLength(1);
        await replay(env, workflowId);
      });
      // The first worker stops with the admitted queue still in history.
      const resumed = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowBundle,
      });
      await resumed.runUntil(async () => {
        const lastDelivery = once(delivery, "last-delivery", { signal });
        release.resolve(undefined);
        // Wait for the final child to persist its Activity result before replay.
        await lastDelivery;
        await env.client.workflow.withAbortSignal(signal, () =>
          env.client.workflow
            .getHandle(photonCommandWorkflowId(last.messageId))
            .result(),
        );
        expect(prepared.map((input) => input.sourceSequence)).toEqual(
          Array.from({ length: 50 }, (_, index) => index + 1),
        );
        expect(delivered).toEqual(
          [first, ...backlog].map((input) => input.messageId),
        );
        await replay(env, workflowId);
        await env.client.workflow.getHandle(workflowId).cancel();
      });
    } finally {
      release.resolve(undefined);
      activityWorker.shutdown();
      await runningActivities;
      await env.teardown();
    }
  }, 90_000);

  test("carries dedupe and ordering across continue-as-new", async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const first = message("rollover-0");
    const workflowId = photonConversationWorkflowId(first.conversationId);
    let deliveries = 0;
    const activityWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_PHOTON,
      activities: {
        preparePhotonCommand: () => ({ kind: "message", content: "help" }),
        deliverPhotonResponse: () => {
          deliveries += 1;
          return { messageId: "outgoing" };
        },
      },
    });
    const activities = activityWorker.run();
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowBundle,
    });
    try {
      await worker.runUntil(async () => {
        await admitPhotonMessage(env.client.workflow, first);
        const handle = env.client.workflow.getHandle(workflowId);
        const original = await handle.describe();
        for (let index = 1; index < 100; index += 1) {
          await expect.poll(() => deliveries, { timeout: 10_000 }).toBe(index);
          await admitPhotonMessage(
            env.client.workflow,
            message(`rollover-${String(index)}`),
          );
        }
        await expect
          .poll(
            async () => {
              const description = await handle.describe();
              return description.runId;
            },
            { timeout: 10_000 },
          )
          .not.toBe(original.runId);
        const state = PhotonConversationStateSchema.parse(
          await handle.query(photonConversationStateQuery),
        );
        expect(state.nextSequence).toBe(101);
        expect(state.recent).toHaveLength(100);
        expect(state.latestTimestamp).toBe(PHOTON_NOW);
        expect(
          await admitPhotonMessage(env.client.workflow, first),
        ).toMatchObject({ status: "duplicate" });
        expect(deliveries).toBe(100);
        await replay(env, workflowId, original.runId);
        await handle.cancel();
      });
    } finally {
      activityWorker.shutdown();
      await activities;
      await env.teardown();
    }
  }, 120_000);
});

async function recordTwoTurnConversationHistory(input: {
  env: TestWorkflowEnvironment;
  worker: Worker;
  delivered: string[];
  prefix: string;
}) {
  const { env, worker, delivered, prefix } = input;
  const conversationId = `photon-conv-${prefix}`;
  const first = { ...message(`${prefix}-1`), conversationId };
  const second = { ...message(`${prefix}-2`), conversationId };
  const workflowId = photonConversationWorkflowId(conversationId);
  return await worker.runUntil(async () => {
    expect(await admitPhotonMessage(env.client.workflow, first)).toMatchObject({
      status: "accepted",
    });
    await expect
      .poll(() => delivered.includes(first.messageId), { timeout: 10_000 })
      .toBe(true);
    const handle = env.client.workflow.getHandle(workflowId);
    expect(
      await handle.executeUpdate(admitPhotonMessageUpdate, { args: [second] }),
    ).toMatchObject({ status: "accepted" });
    await expect
      .poll(() => delivered.includes(second.messageId), { timeout: 10_000 })
      .toBe(true);
    const history = await handle.fetchHistory();
    await handle.cancel();
    return history;
  });
}

describe("Photon conversation tracing replay determinism", () => {
  test("replays conversation updates deterministically across call-graph tracing on and off", async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    let exportedSpanBatches = 0;
    const dummyTracingSinks = {
      exporter: {
        export: {
          fn: () => {
            exportedSpanBatches += 1;
          },
          callDuringReplay: false,
        },
      },
    };
    const delivered: string[] = [];
    const activityWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_PHOTON,
      activities: {
        preparePhotonCommand: () => ({ kind: "message", content: "help" }),
        deliverPhotonResponse: (input: PhotonDelivery) => {
          delivered.push(input.messageId);
          return { messageId: "outgoing" };
        },
      },
    });
    const activities = activityWorker.run();
    try {
      const tracedWorker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath,
        interceptors: {
          workflowModules: [temporalWorkflowTracingModulePath()],
        },
        sinks: dummyTracingSinks,
      });
      const tracedHistory = await recordTwoTurnConversationHistory({
        env,
        worker: tracedWorker,
        delivered,
        prefix: "traced",
      });
      expect(exportedSpanBatches).toBeGreaterThan(0);
      await Worker.runReplayHistory({ workflowBundle }, tracedHistory);

      const untracedWorker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowBundle,
      });
      const untracedHistory = await recordTwoTurnConversationHistory({
        env,
        worker: untracedWorker,
        delivered,
        prefix: "untraced",
      });
      await Worker.runReplayHistory(
        {
          workflowsPath,
          interceptors: {
            workflowModules: [temporalWorkflowTracingModulePath()],
          },
          sinks: dummyTracingSinks,
        },
        untracedHistory,
      );
    } finally {
      activityWorker.shutdown();
      await activities;
      await env.teardown();
    }
  }, 120_000);
});
