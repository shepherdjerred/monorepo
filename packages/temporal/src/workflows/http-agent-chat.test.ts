import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import type { AgentChatTurnResult } from "#shared/agent/agent-chat.ts";
import type { HttpAgentChatCommand } from "#shared/agent/agent-chat-http.ts";
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
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    });
    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
      activities: {
        executeHttpAgentChatCommand: () => RESULT,
      },
    });
    const activityRun = activityWorker.run();
    try {
      const result = await workflowWorker.runUntil(
        environment.client.workflow.execute("httpAgentChatWorkflow", {
          workflowId: `http-agent-chat-test-${crypto.randomUUID()}`,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [COMMAND],
        }),
      );
      expect(result).toEqual(RESULT);
    } finally {
      activityWorker.shutdown();
      await activityRun;
      await environment.teardown();
    }
  }, 60_000);
});
