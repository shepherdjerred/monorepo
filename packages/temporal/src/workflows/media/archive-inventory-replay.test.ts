import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

test.each(["old_completed_phase", "new_archive_phase"] as const)(
  "unchanged inventory Workflow consumes %s activity replies and replays",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
    const calls: unknown[] = [];
    const replies =
      mode === "old_completed_phase"
        ? [{ processed: 0, nextCursor: null }]
        : [
            { processed: 0, nextCursor: "archives" },
            { processed: 25, nextCursor: "next-archive-page" },
            { processed: 2, nextCursor: null },
          ];
    const network = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        sweepMediaWork: (input: unknown) => {
          calls.push(input);
          expect(Context.current().info.startToCloseTimeoutMs).toBe(300_000);
          const reply = replies.shift();
          if (reply === undefined)
            throw new Error("Unexpected extra inventory page");
          return Promise.resolve(reply);
        },
      },
    });
    const workflow = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const running = network.run();
    try {
      const sweepId = crypto.randomUUID();
      const handle = await environment.client.workflow.start(
        "sweepMediaWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ kind: "inventory", cursor: "cleanup", sweepId }],
        },
      );
      expect(await workflow.runUntil(handle.result())).toEqual({
        processed: mode === "old_completed_phase" ? 0 : 27,
      });
      expect(calls[0]).toEqual({
        kind: "inventory",
        cursor: "cleanup",
        sweepId,
      });
      expect(calls).toHaveLength(mode === "old_completed_phase" ? 1 : 3);
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      network.shutdown();
      await running;
      await environment.teardown();
    }
  },
  60_000,
);
