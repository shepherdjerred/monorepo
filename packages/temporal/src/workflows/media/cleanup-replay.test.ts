import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const oldWorkflowsPath = new URL(
  "fixtures/cleanup-before-observation.ts",
  import.meta.url,
).pathname;
const workflowsPath = new URL("../index.ts", import.meta.url).pathname;

test.each(["terminal", "protected_then_terminal"] as const)(
  "retained pre-observation cleanup history %s replays without a new Network observation command",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const started: { worker: Worker; running: Promise<void> }[] = [];
    const calls: { kind: string; input: unknown }[] = [];
    let cleanups = 0;
    try {
      const workflow = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath: oldWorkflowsPath,
      });
      const files = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: {
          cleanupSupersededMediaFile: (input: unknown) => {
            const info = Context.current().info;
            expect(info.startToCloseTimeoutMs).toBe(43_200_000);
            expect(info.heartbeatTimeoutMs).toBe(60_000);
            calls.push({ kind: "files", input });
            cleanups++;
            return Promise.resolve(
              mode === "protected_then_terminal" && cleanups === 1
                ? { status: "protected", reason: "fixture_protected" }
                : { status: "purged" },
            );
          },
        },
      });
      const network = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          finishMediaOperation: (input: unknown) => {
            expect(Context.current().info.startToCloseTimeoutMs).toBe(300_000);
            calls.push({ kind: "finish", input });
            return Promise.resolve();
          },
          observeMediaUpgradeCleanup: () => {
            throw new Error(
              "Pre-observation Workflow scheduled a new Activity",
            );
          },
        },
      });
      for (const worker of [files, network])
        started.push({ worker, running: worker.run() });
      const input = {
        operationId: crypto.randomUUID(),
        cleanupId: crypto.randomUUID(),
      };
      const handle = await environment.client.workflow.start(
        "cleanupMediaUpgradeWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [input],
        },
      );
      expect(await workflow.runUntil(handle.result())).toEqual({
        status: "completed",
      });
      const terminal = [
        { kind: "files", input },
        {
          kind: "finish",
          input: {
            operationId: input.operationId,
            status: "completed",
            reason: null,
          },
        },
      ];
      expect(calls).toEqual(
        mode === "terminal"
          ? terminal
          : [
              { kind: "files", input },
              {
                kind: "finish",
                input: {
                  operationId: input.operationId,
                  status: "reconciling",
                  reason: "fixture_protected",
                },
              },
              ...terminal,
            ],
      );
      const history = await handle.fetchHistory();
      expect(JSON.stringify(history)).not.toContain(
        "observeMediaUpgradeCleanup",
      );
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      try {
        for (const { worker } of started) worker.shutdown();
        await Promise.all(started.map(({ running }) => running));
      } finally {
        await environment.teardown();
      }
    }
  },
  60_000,
);
