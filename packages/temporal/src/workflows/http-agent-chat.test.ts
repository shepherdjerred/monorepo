import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import {
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_MAX_ATTEMPTS,
  AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  activateHttpAgentChatCommandUpdate,
  type HttpAgentChatActivityInput,
  type HttpAgentChatCommand,
} from "#shared/agent/agent-chat-http.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const COMMAND: HttpAgentChatCommand = {
  kind: "continue",
  chatId: "scheduled-chat",
  request: {
    turnId: "imessage-123",
    prompt: "Continue the investigation.",
    submittedAt: "2026-09-14T22:00:00.000Z",
    source: { kind: "imessage", conversationId: "bluebubbles-chat" },
  },
};

const RESULT: AgentChatTurnResult = {
  turnId: COMMAND.request.turnId,
  turnNumber: 2,
  finalText: "The durable answer.",
  providerSessionId: "provider-session",
  sessionManifestKey: "agent-chats/sessions/scheduled-chat/manifest.json",
  completedAt: "2026-09-14T22:01:00.000Z",
  usage: {
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheWriteInputTokens: 0,
    outputTokens: 5,
    reasoningTokens: 1,
  },
};

describe("httpAgentChatWorkflow", () => {
  test("durably checkpoints the HTTP command result", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let activityInput: HttpAgentChatActivityInput | undefined;
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    });
    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
      activities: {
        executeHttpAgentChatCommand: (input: HttpAgentChatActivityInput) => {
          activityInput = input;
          return RESULT;
        },
      },
    });
    const activityRun = activityWorker.run();
    const workflowId = `http-agent-chat-test-${crypto.randomUUID()}`;
    try {
      const result = await workflowWorker.runUntil(
        environment.client.workflow.execute("httpAgentChatWorkflow", {
          workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [COMMAND],
        }),
      );
      expect(result).toEqual(RESULT);
      const history = await environment.client.workflow
        .getHandle(workflowId)
        .fetchHistory();
      const scheduled = history.events?.find(
        (event) =>
          event.activityTaskScheduledEventAttributes !== null &&
          event.activityTaskScheduledEventAttributes !== undefined,
      );
      expect(
        Number(
          scheduled?.activityTaskScheduledEventAttributes?.startToCloseTimeout
            ?.seconds,
        ),
      ).toBe(AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS / 1000);
      expect(
        Number(
          scheduled?.activityTaskScheduledEventAttributes
            ?.scheduleToCloseTimeout?.seconds,
        ),
      ).toBe(AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS / 1000);
      expect(
        scheduled?.activityTaskScheduledEventAttributes?.retryPolicy
          ?.maximumAttempts,
      ).toBe(AGENT_CHAT_INGRESS_MAX_ATTEMPTS);
      const description = await environment.client.workflow
        .getHandle(workflowId)
        .describe();
      expect(activityInput?.providerStartDeadline).toBe(
        new Date(
          description.startTime.getTime() +
            AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
        ).toISOString(),
      );
    } finally {
      activityWorker.shutdown();
      await activityRun;
      await environment.teardown();
    }
  }, 60_000);

  test("claims command identity before activating an adopted chat owner", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let activityInput: HttpAgentChatActivityInput | undefined;
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    });
    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
      activities: {
        executeHttpAgentChatCommand: (input: HttpAgentChatActivityInput) => {
          activityInput = input;
          return RESULT;
        },
      },
    });
    const workflowRun = workflowWorker.run();
    const activityRun = activityWorker.run();
    const workflowId = `http-agent-chat-claim-test-${crypto.randomUUID()}`;
    const claimed: HttpAgentChatCommand = {
      kind: "new",
      config: {
        chatId: "claimed-chat",
        title: "Claimed chat",
        provider: "codex",
        model: "gpt-5.6-luna",
        origin: { kind: "imessage", conversationId: "bluebubbles-chat" },
        createdAt: "2026-09-14T22:00:00.000Z",
        maxTurnsPerMessage: 24,
      },
      request: COMMAND.request,
    };
    const adopted: HttpAgentChatCommand = {
      ...claimed,
      config: {
        ...claimed.config,
        createdAt: "2026-09-14T21:59:00.000Z",
      },
    };
    try {
      const handle = await environment.client.workflow.start(
        "httpAgentChatWorkflow",
        {
          workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [claimed, { waitForActivation: true }],
        },
      );
      await expect(
        handle.executeUpdate(activateHttpAgentChatCommandUpdate, {
          args: [
            {
              ...claimed,
              request: { ...claimed.request, prompt: "different" },
            },
          ],
          updateId: "mismatch",
        }),
      ).rejects.toThrow("Workflow Update failed");
      expect(activityInput).toBeUndefined();

      await handle.executeUpdate(activateHttpAgentChatCommandUpdate, {
        args: [adopted],
        updateId: "activate",
      });
      expect(await handle.result()).toEqual(RESULT);
      expect(activityInput?.command).toEqual(adopted);
    } finally {
      workflowWorker.shutdown();
      activityWorker.shutdown();
      await workflowRun;
      await activityRun;
      await environment.teardown();
    }
  }, 60_000);
});
