import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure, Context, heartbeat } from "@temporalio/activity";
import { WorkflowFailedError } from "@temporalio/client";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("library-handoff-v3.ts", import.meta.url)
  .pathname;

test.each(["complete", "failure", "cancel"] as const)(
  "library v3 %s uses separate role workers, durable protection and replay",
  { timeout: 60_000 },
  async (scenario) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    const entered = Promise.withResolvers<undefined>();
    const calls: string[] = [];
    let applied = false;
    const input = {
      planId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
    };
    const assetId = crypto.randomUUID();
    const proof = { id: crypto.randomUUID(), evidenceHash: "a".repeat(64) };
    try {
      const workflowWorker = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath,
      });
      workers.push(workflowWorker);
      const networkWorker = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          observeMediaHandoff() {
            calls.push("observe");
          },
          plannedLibraryPlexEdits() {
            calls.push("planned");
            return { assetIds: [assetId] };
          },
          editLibraryPlexEdition(value: unknown) {
            expect(value).toEqual({
              ...input,
              schemaVersion: 3,
              assetId,
              filesObservation: proof,
            });
            calls.push("edit");
            if (scenario === "failure")
              throw ApplicationFailure.create({
                message: "Synthetic changed identity",
                nonRetryable: true,
              });
            return proof;
          },
          protectLibraryHandoff() {
            calls.push("protect");
          },
          mediaHandoffState() {
            return { state: applied ? "applied" : "requires_review", applied };
          },
          finishMediaOperation(value: { status: string }) {
            calls.push(value.status);
          },
        },
      });
      const fileWorker = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        maxHeartbeatThrottleInterval: 100,
        activities: {
          async prepareLibraryPlexEditFile(value: unknown) {
            expect(value).toEqual({ ...input, schemaVersion: 3, assetId });
            calls.push("file-proof");
            entered.resolve(undefined);
            if (scenario === "cancel") {
              while (!Context.current().cancellationSignal.aborted) {
                heartbeat({ phase: "fixture-hash" });
                await Context.current().sleep(25);
              }
              await Context.current().cancelled;
            }
            return proof;
          },
          applyMediaHandoffFiles() {
            applied = true;
            calls.push("apply");
          },
        },
      });
      workers.push(networkWorker, fileWorker);
      running.push(networkWorker.run(), fileWorker.run());
      const handle = await environment.client.workflow.start(
        "applyLibraryHandoffV3Workflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [input],
        },
      );
      await workflowWorker.runUntil(async () => {
        if (scenario === "cancel") {
          await entered.promise;
          await handle.cancel();
        }
        if (scenario === "complete") await handle.result();
        else
          await expect(handle.result()).rejects.toBeInstanceOf(
            WorkflowFailedError,
          );
      });
      expect(applied).toBe(scenario === "complete");
      if (scenario === "complete")
        expect(calls).toEqual([
          "observe",
          "planned",
          "file-proof",
          "edit",
          "observe",
          "apply",
          "completed",
        ]);
      else {
        expect(calls).toContain("protect");
        expect(calls.at(-1)).toBe("reconciling");
        expect(calls).not.toContain("apply");
      }
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      for (const worker of workers)
        if (worker.getState() === "RUNNING") worker.shutdown();
      try {
        await Promise.all(running);
      } finally {
        await environment.teardown();
      }
    }
  },
);
