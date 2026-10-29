import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { WorkflowFailedError } from "@temporalio/client";
import { setTimeout } from "node:timers/promises";
import { expect } from "vitest";
import type { MovieNetworkActivitiesV4 } from "@shepherdjerred/media/movie-lifecycle";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export const workflowsPath = new URL("retention.ts", import.meta.url).pathname;
export const retentionInput = {
  schemaVersion: 4 as const,
  operationId: "1d939b2b-d177-4236-a92a-d9f431bb3ec3",
  mediaId: "17e747b3-9c31-4901-908a-91821b58906e",
  generation: 1,
  scope: {
    rootMediaId: "17e747b3-9c31-4901-908a-91821b58906e",
    mediaId: "17e747b3-9c31-4901-908a-91821b58906e",
    edition: "extended_cut" as const,
  },
};

export async function runRetentionScenario(
  effect: "quarantine" | "purge",
  mode:
    | "success"
    | "provider_failure"
    | "intent_changed"
    | "cancelled"
    | "completion_obsolete",
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
  const completions: string[] = [];
  const evaluate: MovieNetworkActivitiesV4["evaluateMovieRetentionV4"] = async (
    input,
  ) => {
    expect(input).toEqual(retentionInput);
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
      decisionId: "993cff6c-454e-4e1d-9390-3cb9f690c461",
      reason: null,
      wakeAt: null,
    };
  };
  const fileEffect = async (input: unknown) => {
    expect(input).toEqual({
      schemaVersion: 4,
      operationId: retentionInput.operationId,
      decisionId: "993cff6c-454e-4e1d-9390-3cb9f690c461",
      scope: retentionInput.scope,
    });
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
      evaluateMovieRetentionV4: evaluate,
      completeMovieRemovalV4: (input: unknown) => {
        expect(input).toEqual({
          schemaVersion: 4,
          operationId: retentionInput.operationId,
          decisionId: "993cff6c-454e-4e1d-9390-3cb9f690c461",
          scope: retentionInput.scope,
          stage: effect === "purge" ? "purged" : "quarantined",
        });
        expect(effects).toBe(1);
        expect(finishes).toEqual([]);
        completions.push(effect);
        return mode === "completion_obsolete"
          ? { status: "obsolete", reason: "selected_completion_obsolete" }
          : { status: "completed", reason: null };
      },
      finishMediaOperation: (input: { status: string }) => {
        finishes.push(input.status);
      },
    },
  });
  const fileWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    maxHeartbeatThrottleInterval: 1,
    activities: {
      quarantineMovieFilesV4: fileEffect,
      purgeMovieFilesV4: fileEffect,
    },
  });
  const networkRun = networkWorker.run();
  const fileRun = fileWorker.run();
  try {
    const handle = await environment.client.workflow.start(
      "retainMovieEditionV4Workflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [
          {
            ...retentionInput,
            kind: "retain_movie_edition_v4",
            recoveryEpoch: 1,
            cursor: null,
            scope: { ...retentionInput.scope, outboxOnly: "discard" },
          },
        ],
      },
    );
    const result: unknown = await workflowWorker.runUntil(async () => {
      const activity = await entered.promise;
      if (mode === "cancelled") await handle.cancel();
      const succeeds = mode === "success" || mode === "completion_obsolete";
      for (let step = 0; step < (succeeds ? 7 : 4); step++) {
        activity.heartbeat("verification-in-progress");
        await setTimeout(10);
        await environment.sleep("10 seconds");
        await setTimeout(10);
      }
      if (succeeds) release.resolve(undefined);
      try {
        const completedResult: unknown = await handle.result();
        return completedResult;
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
      completions,
    };
  } finally {
    release.resolve(undefined);
    networkWorker.shutdown();
    fileWorker.shutdown();
    await Promise.all([networkRun, fileRun]);
    await environment.teardown();
  }
}
