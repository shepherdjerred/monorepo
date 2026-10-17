import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowFailedError } from "@temporalio/client";
import { setTimeout } from "node:timers/promises";
import { expect, test } from "vitest";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("retention.ts", import.meta.url).pathname;

test.each(["quarantine", "purge"] as const)(
  "%s refreshes authority while one files Activity verifies for more than 60 seconds",
  async (effect) => {
    const result = await runRetentionScenario(effect, "success");
    expect(result.result).toEqual({ status: "completed" });
    expect(result.fileCalls).toBe(1);
    expect(result.effects).toBe(1);
    expect(result.elapsed).toBeGreaterThan(60_000);
    expect(result.observations).toBeGreaterThanOrEqual(4);
    expect(result.finishes).toEqual(["completed"]);
  },
  120_000,
);

test.each(["provider_failure", "intent_changed", "cancelled"] as const)(
  "retention %s cancels the pending file effect and stops observations",
  async (mode) => {
    const result = await runRetentionScenario("purge", mode);
    expect(result.result).toEqual(
      mode === "cancelled"
        ? { cancelled: true }
        : {
            status: "waiting",
            reason: "retention_refresh_failed_requires_reconciliation",
          },
    );
    expect(result.fileCalls).toBe(1);
    expect(result.effects).toBe(0);
    expect(result.cancelled).toBe(true);
    expect(result.finishes).toEqual(["reconciling"]);
  },
  60_000,
);

async function runRetentionScenario(
  effect: "quarantine" | "purge",
  mode: "success" | "provider_failure" | "intent_changed" | "cancelled",
) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const entered = Promise.withResolvers<Context>();
  const release = Promise.withResolvers<undefined>();
  let observations = 0;
  let observedAt = 0;
  let fileCalls = 0;
  let effects = 0;
  let elapsed = 0;
  let cancelled = false;
  let completed = false;
  const finishes: string[] = [];
  const evaluate: MediaNetworkActivities["evaluateMediaRetention"] =
    async () => {
      observations++;
      observedAt = await environment.currentTimeMs();
      if (mode === "provider_failure" && observations > 1)
        throw new Error("Fixture provider unavailable");
      return {
        status: completed
          ? "complete"
          : mode === "intent_changed" && observations > 1
            ? "obsolete"
            : effect,
        decisionId: "decision",
        reason: null,
        wakeAt: null,
      };
    };
  const fileEffect = async () => {
    fileCalls++;
    const context = Context.current();
    const start = await environment.currentTimeMs();
    context.heartbeat("verification-started");
    entered.resolve(context);
    try {
      await Promise.race([release.promise, context.cancelled]);
      const now = await environment.currentTimeMs();
      elapsed = now - start;
      expect(now - observedAt).toBeLessThan(60_000);
      effects++;
      completed = true;
      return { status: effect === "purge" ? "purged" : "quarantined" };
    } catch (error) {
      cancelled = true;
      throw error;
    }
  };
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const networkWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      evaluateMediaRetention: evaluate,
      finishMediaOperation: async (input: { status: string }) => {
        finishes.push(input.status);
      },
    },
  });
  const fileWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    maxHeartbeatThrottleInterval: 1,
    activities: {
      quarantineMediaFiles: fileEffect,
      purgeMediaFiles: fileEffect,
    },
  });
  const networkRun = networkWorker.run();
  const fileRun = fileWorker.run();
  try {
    const handle = await environment.client.workflow.start(
      "retainMediaWorkflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ operationId: "operation", mediaId: "media", generation: 1 }],
      },
    );
    const result: unknown = await workflowWorker.runUntil(async () => {
      const activity = await entered.promise;
      if (mode === "cancelled") await handle.cancel();
      for (let step = 0; step < (mode === "success" ? 7 : 4); step++) {
        activity.heartbeat("verification-in-progress");
        await setTimeout(10);
        await environment.sleep("10 seconds");
        await setTimeout(10);
      }
      if (mode === "success") release.resolve(undefined);
      try {
        return await handle.result();
      } catch (error) {
        if (mode !== "cancelled" || !(error instanceof WorkflowFailedError))
          throw error;
        return { cancelled: true };
      }
    });
    const settledObservations = observations;
    await environment.sleep("1 minute");
    expect(observations).toBe(settledObservations);
    await Worker.runReplayHistory(
      { workflowsPath },
      await handle.fetchHistory(),
    );
    return {
      result,
      observations,
      fileCalls,
      effects,
      elapsed,
      cancelled,
      finishes,
    };
  } finally {
    release.resolve(undefined);
    networkWorker.shutdown();
    fileWorker.shutdown();
    await Promise.all([networkRun, fileRun]);
    await environment.teardown();
  }
}
