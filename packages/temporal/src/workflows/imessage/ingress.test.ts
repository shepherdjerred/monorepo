import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  BlueBubblesCursorSchema,
  type BlueBubblesCursor,
  type ImessageCommand,
} from "#shared/agent/agent-chat-imessage.ts";

describe("BlueBubbles durable cursor", () => {
  test("settles selections before following messages and retains its cursor across continue-as-new and replay", async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
    const workflowWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const received: string[] = [];
    let lastCursor: BlueBubblesCursor | undefined;
    let selected = false;
    const activityWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_IMESSAGE,
      activities: {
        pollBlueBubblesMessages: (cursor: BlueBubblesCursor) => {
          lastCursor = cursor;
          return {
            startedAt: cursor.startedAt,
            lastRowId: 2,
            commands:
              cursor.lastRowId === 0
                ? [
                    {
                      messageId: "selection",
                      conversationId: "dm",
                      submittedAt: cursor.startedAt,
                      action: { kind: "use", chatId: "scheduled-chat" },
                    },
                    {
                      messageId: "next-turn",
                      conversationId: "dm",
                      submittedAt: cursor.startedAt,
                      action: { kind: "continue", prompt: "continue" },
                    },
                  ]
                : [],
          };
        },
        prepareImessageCommand: (command: ImessageCommand) => {
          if (!selected && command.messageId === "next-turn")
            throw new Error("Selection raced the next message");
          return { kind: "message", content: command.messageId };
        },
        deliverImessageResponse: (input: { messageId: string }) => {
          received.push(input.messageId);
          if (input.messageId === "selection") selected = true;
        },
      },
    });
    const activities = activityWorker.run();
    try {
      await workflowWorker.runUntil(async () => {
        const handle = await env.client.workflow.start(
          "blueBubblesIngressWorkflow",
          {
            workflowId: `bb-cursor-${crypto.randomUUID()}`,
            taskQueue: TASK_QUEUES.WORKFLOWS,
            args: [{ startedAt: "2026-09-17T00:00:00.000Z", lastRowId: 0 }],
          },
        );
        const first = await handle.describe();
        await env.sleep("55 minutes");
        const current = env.client.workflow.getHandle(handle.workflowId);
        const state = BlueBubblesCursorSchema.parse(lastCursor);
        expect(state).toEqual({
          startedAt: "2026-09-17T00:00:00.000Z",
          lastRowId: 2,
        });
        const currentDescription = await current.describe();
        expect(currentDescription.runId).not.toBe(first.runId);
        expect(received).toEqual(["selection", "next-turn"]);
        const original = env.client.workflow.getHandle(
          handle.workflowId,
          first.runId,
        );
        await Worker.runReplayHistory(
          { workflowsPath },
          await original.fetchHistory(),
        );
        await current.cancel();
        await expect(current.result()).rejects.toThrow();
      });
    } finally {
      activityWorker.shutdown();
      await activities;
      await env.teardown();
    }
  }, 90_000);
});
