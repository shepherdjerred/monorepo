import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import {
  AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_MAX_ATTEMPTS,
  AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
} from "#shared/agent/agent-chat.ts";
import type { HttpAgentChatActivityInput } from "#shared/agent/agent-chat-http.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { PreparedImessageCommandSchema } from "#shared/agent/agent-chat-imessage.ts";
import type { z } from "zod/v4";

const INPUT = {
  messageId: "incoming-guid",
  conversationId: "owner-dm",
  submittedAt: "2026-09-17T00:00:00.000Z",
  sourceSequence: 1,
  action: { kind: "continue", prompt: "continue" },
} as const;
const TURN: z.infer<typeof PreparedImessageCommandSchema> = {
  kind: "turn",
  command: {
    kind: "continue",
    chatId: "scheduled-chat",
    request: {
      turnId: "imessage-guid",
      prompt: "continue",
      submittedAt: INPUT.submittedAt,
      source: { kind: "imessage", conversationId: INPUT.conversationId },
      sourceSequence: INPUT.sourceSequence,
    },
  },
};

describe("durable iMessage response Workflow", () => {
  test.each(["success", "provider-failure", "delivery-failure", "help"])(
    "checkpoints response and never automatically repeats a BlueBubbles send: %s",
    async (scenario) => {
      const env = await TestWorkflowEnvironment.createTimeSkipping();
      let prepares = 0;
      let executions = 0;
      let activityInput: HttpAgentChatActivityInput | undefined;
      const deliveries: {
        conversationId: string;
        messageId: string;
        content: string;
      }[] = [];
      const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
      const workers = await Promise.all([
        Worker.create({
          connection: env.nativeConnection,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          workflowsPath,
        }),
        Worker.create({
          connection: env.nativeConnection,
          taskQueue: TASK_QUEUES.AGENT_CHAT_IMESSAGE,
          activities: {
            prepareImessageCommand: () => {
              prepares += 1;
              return scenario === "help"
                ? { kind: "message", content: "help" }
                : TURN;
            },
            deliverImessageResponse: (input: {
              conversationId: string;
              messageId: string;
              content: string;
            }) => {
              deliveries.push(input);
              if (scenario === "delivery-failure")
                throw new Error("lost send response");
            },
          },
        }),
        Worker.create({
          connection: env.nativeConnection,
          taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
          activities: {
            executeHttpAgentChatCommand: (
              input: HttpAgentChatActivityInput,
            ) => {
              activityInput = input;
              executions += 1;
              if (scenario === "provider-failure")
                throw ApplicationFailure.nonRetryable(
                  "weekly limit",
                  "AgentChatTurnFailed",
                );
              return {
                turnId: "imessage-guid",
                turnNumber: 1,
                finalText: "durable answer",
                providerSessionId: "session",
                sessionManifestKey: "sessions/manifest.json",
                completedAt: INPUT.submittedAt,
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
        }),
      ]);
      const [workflowWorker, ...activityWorkers] = workers;
      if (workflowWorker === undefined)
        throw new Error("Missing Workflow Worker");
      const running = activityWorkers.map((worker) => worker.run());
      const workflowId = `imessage-test-${crypto.randomUUID()}`;
      try {
        const execution = workflowWorker.runUntil(
          env.client.workflow.execute("imessageAgentChatWorkflow", {
            taskQueue: TASK_QUEUES.WORKFLOWS,
            workflowId,
            args: [INPUT],
          }),
        );
        if (scenario === "delivery-failure")
          await expect(execution).rejects.toThrow();
        else await execution;
        expect(prepares).toBe(1);
        expect(executions).toBe(scenario === "help" ? 0 : 1);
        if (scenario === "help") {
          expect(activityInput).toBeUndefined();
        } else {
          const handle = env.client.workflow.getHandle(workflowId);
          const description = await handle.describe();
          expect(activityInput?.providerStartDeadline).toBe(
            new Date(
              description.startTime.getTime() +
                AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
            ).toISOString(),
          );
          const history = await handle.fetchHistory();
          const commandActivity = history.events?.find(
            (event) =>
              event.activityTaskScheduledEventAttributes?.activityType?.name ===
              "executeHttpAgentChatCommand",
          );
          expect(
            Number(
              commandActivity?.activityTaskScheduledEventAttributes
                ?.scheduleToCloseTimeout?.seconds,
            ),
          ).toBe(AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS / 1000);
          expect(
            commandActivity?.activityTaskScheduledEventAttributes?.retryPolicy
              ?.maximumAttempts,
          ).toBe(AGENT_CHAT_INGRESS_MAX_ATTEMPTS);
        }
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]).toMatchObject({
          conversationId: INPUT.conversationId,
          messageId: INPUT.messageId,
          content:
            scenario === "provider-failure"
              ? expect.stringContaining("will not automatically repeat")
              : scenario === "help"
                ? "help"
                : "durable answer",
        });
        await Worker.runReplayHistory(
          { workflowsPath },
          await env.client.workflow.getHandle(workflowId).fetchHistory(),
        );
      } finally {
        for (const worker of activityWorkers) worker.shutdown();
        await Promise.all(running);
        await env.teardown();
      }
    },
    60_000,
  );
});
