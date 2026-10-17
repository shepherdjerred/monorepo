import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import { ObservePlexHintInputSchema } from "@shepherdjerred/media/plex-events";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  watchCall,
  watchExecution,
} from "#activities/media/watch-execution.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
const input = ObservePlexHintInputSchema.parse({
  schemaVersion: 1,
  kind: "observe_plex_hint",
  operationId: "00000000-0000-4000-8000-000000000001",
  mediaId: "00000000-0000-4000-8000-000000000002",
  recoveryEpoch: 3,
  edition: "default",
  generation: 7,
  serverMachineId: "synthetic-server",
  sectionId: "1",
  ratingKey: "42",
});

test.each(["observed", "superseded", "disabled", "retry", "failure"] as const)(
  "Plex hint %s uses network-only activity, sanitizes history and replays",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let calls = 0;
    const finished: unknown[] = [];
    const workflow = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const network = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        observePlexEventHint: (raw: unknown) =>
          watchCall(() => {
            expect(raw).toEqual(input);
            calls++;
            expect(Context.current().info.startToCloseTimeoutMs).toBe(120_000);
            expect(Context.current().info.scheduleToCloseTimeoutMs).toBe(
              180_000,
            );
            if (mode === "failure" || (mode === "retry" && calls === 1))
              throw new Error(
                "https://private.invalid/events/plex?key=CAPABILITY_CANARY",
              );
            return Promise.resolve({
              status: mode === "retry" ? "observed" : mode,
              complete: mode === "observed" || mode === "retry",
            });
          }),
        finishMediaOperation: (value: unknown) => {
          finished.push(value);
          return Promise.resolve();
        },
      },
    });
    const running = network.run();
    try {
      const handle = await environment.client.workflow.start(
        "observePlexEventHintWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [input],
        },
      );
      const result = workflow.runUntil(handle.result());
      if (mode === "failure") await expect(result).rejects.toThrow();
      else
        expect(await result).toEqual({
          status: mode === "retry" ? "observed" : mode,
          complete: mode === "observed" || mode === "retry",
        });
      expect(calls).toBe(mode === "retry" || mode === "failure" ? 2 : 1);
      expect(finished).toEqual(
        mode === "failure"
          ? []
          : [
              {
                operationId: input.operationId,
                status: "completed",
                reason:
                  mode === "disabled" || mode === "superseded" ? mode : null,
              },
            ],
      );
      const history = await handle.fetchHistory();
      const encoded = JSON.stringify(history);
      expect(encoded).not.toContain("CAPABILITY_CANARY");
      expect(encoded).not.toContain("private.invalid");
      if (mode === "failure")
        expect(encoded).toContain("WatchObservationFailure");
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      network.shutdown();
      await running;
      await environment.teardown();
    }
  },
  60_000,
);

test("unchanged polling Workflow supplies a finite attempt budget without an overall timeout", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let calls = 0;
  const workflow = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const network = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      sweepMediaWork: () => {
        calls++;
        expect(Context.current().info.startToCloseTimeoutMs).toBe(300_000);
        const execution = watchExecution();
        execution.assertActive();
        return Promise.resolve({ processed: 1, nextCursor: null });
      },
    },
  });
  const running = network.run();
  try {
    const handle = await environment.client.workflow.start(
      "sweepMediaWorkflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ kind: "watch" }],
      },
    );
    expect(await workflow.runUntil(handle.result())).toEqual({ processed: 1 });
    expect(calls).toBe(1);
    await Worker.runReplayHistory(
      { workflowsPath },
      await handle.fetchHistory(),
    );
  } finally {
    network.shutdown();
    await running;
    await environment.teardown();
  }
}, 60_000);
