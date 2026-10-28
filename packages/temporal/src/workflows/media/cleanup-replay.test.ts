import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
const histories = [
  {
    name: "pre-observation",
    fixture: "cleanup-before-observation",
    observes: false,
  },
  {
    name: "pre-input-normalization",
    fixture: "cleanup-before-input",
    observes: true,
  },
].flatMap((history) =>
  (["terminal", "protected_then_terminal"] as const).map((mode) => ({
    ...history,
    mode,
  })),
);

test.each(histories)(
  "retained $name cleanup history $mode preserves its original Activity inputs on replay",
  async ({ fixture, observes, mode }) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const started: { worker: Worker; running: Promise<void> }[] = [];
    const calls: { kind: string; input: unknown }[] = [];
    let cleanups = 0;
    try {
      const workflow = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath: new URL(`fixtures/${fixture}.ts`, import.meta.url)
          .pathname,
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
          observeMediaUpgradeCleanup: (input: unknown) => {
            if (!observes)
              throw new Error(
                "Pre-observation Workflow scheduled a new Activity",
              );
            expect(Context.current().info.startToCloseTimeoutMs).toBe(120_000);
            calls.push({ kind: "observe", input });
            return Promise.resolve({ status: "observed" });
          },
        },
      });
      for (const worker of [files, network])
        started.push({ worker, running: worker.run() });
      const input = {
        operationId: crypto.randomUUID(),
        cleanupId: crypto.randomUUID(),
        kind: "cleanup_upgrade",
        recoveryEpoch: 0,
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
        ...(observes ? [{ kind: "observe", input }] : []),
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
              ...(observes ? [{ kind: "observe", input }] : []),
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
      if (!observes)
        expect(JSON.stringify(history)).not.toContain(
          "observeMediaUpgradeCleanup",
        );
      expect(JSON.stringify(history)).not.toContain(
        "media-upgrade-cleanup-input-v2",
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
