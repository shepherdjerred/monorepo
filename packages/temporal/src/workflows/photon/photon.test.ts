import { ApplicationFailure } from "@temporalio/common";
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
  test("serializes commands, durably rejects conflicts/full queues, and resumes pending admission after a worker restart", async () => {
    // Exercise poller restarts against the current full Temporal server.
    const env = await TestWorkflowEnvironment.createLocal();
    const first = message("first");
    const workflowId = photonConversationWorkflowId(first.conversationId);
    const prepared: PhotonCommand[] = [];
    const release = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const delivered: string[] = [];
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
        await admitPhotonMessage(
          env.client.workflow,
          message("late", "2026-10-03T11:59:59.000Z"),
        );
        for (let index = 2; index < 50; index += 1)
          await admitPhotonMessage(
            env.client.workflow,
            message(`pending-${String(index)}`),
          );
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
        release.resolve(undefined);
        await expect.poll(() => delivered.length, { timeout: 20_000 }).toBe(50);
        expect(prepared.map((input) => input.sourceSequence)).toEqual(
          Array.from({ length: 50 }, (_, index) => index + 1),
        );
        expect(delivered[0]).toBe(first.messageId);
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
