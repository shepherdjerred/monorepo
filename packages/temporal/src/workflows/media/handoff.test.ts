import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure, Context, heartbeat } from "@temporalio/activity";
import { WorkflowFailedError } from "@temporalio/client";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("handoff.ts", import.meta.url).pathname;

async function rejectOnAbort(aborted: Promise<undefined>): Promise<never> {
  await aborted;
  throw new Error("Handoff test invocation aborted");
}

test.for(["long-hash", "failure", "cancel"] as const)(
  "handoff %s preserves fresh authority and durable terminal state, with replay",
  { timeout: 60_000 },
  async (scenario, { signal }) => {
    const stages: { phase: string; wall: number; monotonic: number }[] = [];
    const mark = (phase: string) => {
      if (stages.length < 32)
        stages.push({ phase, wall: Date.now(), monotonic: performance.now() });
    };
    mark("environment-start");
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    mark("environment-ready");
    const entered = Promise.withResolvers<undefined>();
    const refreshed = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const aborted = Promise.withResolvers<undefined>();
    let released = false;
    const releaseActivity = () => {
      released = true;
      release.resolve(undefined);
    };
    const diagnose = () => {
      process.stderr.write(`${JSON.stringify({ scenario, stages })}\n`);
    };
    const abort = () => {
      mark("test-aborted");
      diagnose();
      releaseActivity();
      aborted.resolve(undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const wait = <T>(pending: Promise<T>): Promise<T> =>
      Promise.race([pending, rejectOnAbort(aborted.promise)]);
    let observed = 0;
    let applied = false;
    const finished: string[] = [];
    const workers: Worker[] = [];
    const runs: Promise<void>[] = [];
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
          async observeMediaHandoff() {
            mark("network-observed");
            if (++observed >= 2) refreshed.resolve(undefined);
          },
          async mediaHandoffState() {
            return { state: applied ? "applied" : "applying", applied };
          },
          async finishMediaOperation(input: { status: string }) {
            finished.push(input.status);
          },
        },
      });
      workers.push(networkWorker);
      const fileWorker = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        maxHeartbeatThrottleInterval: 100,
        activities: {
          async applyMediaHandoffFiles() {
            mark("files-entered");
            entered.resolve(undefined);
            if (scenario === "failure")
              throw ApplicationFailure.create({
                message: "Fixture evidence changed",
                nonRetryable: true,
              });
            if (scenario === "cancel") {
              while (!Context.current().cancellationSignal.aborted) {
                heartbeat({ phase: "fixture-hash" });
                await Context.current().sleep(25);
              }
              await Context.current().cancelled;
            }
            while (!released) {
              heartbeat({ phase: "fixture-hash" });
              await Promise.race([
                release.promise,
                Context.current().sleep(25),
              ]);
            }
            signal.throwIfAborted();
            if (Context.current().cancellationSignal.aborted)
              await Context.current().cancelled;
            applied = true;
            mark("files-applied");
          },
        },
      });
      workers.push(fileWorker);
      runs.push(networkWorker.run(), fileWorker.run());
      mark("workers-started");
      const handle = await environment.client.workflow.start(
        "applyMediaHandoffWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ operationId: "operation", planId: "plan" }],
        },
      );
      await workflowWorker.runUntil(async () => {
        await wait(entered.promise);
        mark("entered-wait-completed");
        if (scenario === "long-hash") {
          mark("server-sleep-start");
          await wait(environment.sleep("31 seconds"));
          mark("server-sleep-completed");
          await wait(refreshed.promise);
          mark("refresh-wait-completed");
          releaseActivity();
          await wait(handle.result());
          mark("workflow-result-completed");
        } else {
          if (scenario === "cancel") await handle.cancel();
          await expect(wait(handle.result())).rejects.toBeInstanceOf(
            WorkflowFailedError,
          );
        }
      });
      expect(finished).toEqual([
        scenario === "long-hash" ? "completed" : "reconciling",
      ]);
      expect(applied).toBe(scenario === "long-hash");
      if (scenario === "long-hash") expect(observed).toBeGreaterThanOrEqual(2);
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
      mark("replay-completed");
    } catch (error) {
      mark("test-failed");
      diagnose();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      releaseActivity();
      for (const worker of workers)
        if (worker.getState() === "RUNNING") worker.shutdown();
      try {
        await Promise.all(runs);
      } finally {
        await environment.teardown();
      }
    }
  },
);
