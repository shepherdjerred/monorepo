import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { describe, expect, test } from "vitest";
import type {
  DeliverDiscordAgentChatMessageInput,
  DiscordAgentChatCommand,
} from "#shared/agent/agent-chat-discord.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const COMMAND: DiscordAgentChatCommand = {
  kind: "continue",
  interactionId: "123456789012345678",
  channelId: "223456789012345678",
  chatId: "scheduled-chat",
  prompt: "Continue the investigation.",
  submittedAt: "2026-09-14T22:00:00.000Z",
};

describe("discordAgentChatWorkflow", () => {
  test("checkpoints the command result before idempotent message delivery", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const deliveries: DeliverDiscordAgentChatMessageInput[] = [];
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    });
    const activityWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
      activities: {
        executeDiscordAgentChatCommand: () => ({
          messages: ["first chunk", "second chunk"],
        }),
        deliverDiscordAgentChatMessage: (
          input: DeliverDiscordAgentChatMessageInput,
        ) => {
          deliveries.push(input);
        },
      },
    });
    const activityRun = activityWorker.run();
    try {
      await workflowWorker.runUntil(
        environment.client.workflow.execute("discordAgentChatWorkflow", {
          workflowId: `discord-agent-chat-test-${crypto.randomUUID()}`,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [COMMAND],
        }),
      );
    } finally {
      activityWorker.shutdown();
      await activityRun;
      await environment.teardown();
    }

    expect(deliveries).toEqual([
      {
        channelId: COMMAND.channelId,
        content: "first chunk",
        nonce: `${COMMAND.interactionId}00`,
      },
      {
        channelId: COMMAND.channelId,
        content: "second chunk",
        nonce: `${COMMAND.interactionId}01`,
      },
    ]);
  }, 60_000);
});
