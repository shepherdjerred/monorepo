import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { setTimeout } from "node:timers/promises";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("maintenance.ts", import.meta.url).pathname;
test.each(["complete", "interrupted", "cancelled", "recovery"] as const)(
  "Plex maintenance %s preserves cleanup and replays",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const calls: string[] = [];
    let scans = 0;
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const networkWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        validatePlexExclusionExecution: () => {
          calls.push("validate");
          return Promise.resolve();
        },
        reconcilePlexExclusionScan: () => {
          scans++;
          return Promise.resolve({
            state:
              mode === "cancelled" || scans % 2 === 1 ? "waiting" : "verified",
            reason: null,
          });
        },
        finishPlexExclusion: () => {
          calls.push("finish");
          return Promise.resolve();
        },
        recordPlexExclusionIntervention: () => {
          calls.push("intervention");
          return Promise.resolve();
        },
      },
    });
    const fileWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: {
        stagePlexExclusionFiles: () => {
          calls.push("stage");
          return mode === "interrupted"
            ? Promise.reject(new Error("fixture interrupted stage"))
            : Promise.resolve();
        },
        cleanupPlexExclusionFiles: () => {
          calls.push("cleanup");
          return Promise.resolve();
        },
      },
    });
    const networkRun = networkWorker.run();
    const fileRun = fileWorker.run();
    try {
      const handle = await environment.client.workflow.start(
        mode === "recovery"
          ? "recoverPlexExclusionWorkflow"
          : "executePlexExclusionWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ operationId: "operation", runId: "run" }],
        },
      );
      await workflowWorker.runUntil(async () => {
        if (mode === "cancelled") {
          let cancelled = false;
          for (let poll = 0; poll < 300; poll++) {
            const history = await handle.fetchHistory();
            if (
              history.events?.some(
                (event) => event.timerStartedEventAttributes != null,
              ) === true
            ) {
              await handle.cancel();
              cancelled = true;
              break;
            }
            await setTimeout(10);
          }
          if (!cancelled)
            throw new Error("Workflow did not reach a durable wait");
        }
        await handle.result();
      });
      expect(calls).toEqual(
        mode === "recovery"
          ? ["validate", "cleanup", "finish"]
          : mode === "complete"
            ? ["validate", "stage", "cleanup", "finish"]
            : [
                "validate",
                ...Array.from(
                  { length: mode === "interrupted" ? 3 : 1 },
                  () => "stage",
                ),
                "cleanup",
                "intervention",
              ],
      );
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      networkWorker.shutdown();
      fileWorker.shutdown();
      await Promise.all([networkRun, fileRun]);
      await environment.teardown();
    }
  },
  60_000,
);
