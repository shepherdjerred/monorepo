import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import type { MovieNetworkActivitiesV4 } from "@shepherdjerred/media/movie-lifecycle";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  runRetentionScenario,
  retentionInput,
  workflowsPath,
} from "./retention.test-support.ts";

test.each(["quarantine", "purge"] as const)(
  "scoped %s retains authoritative refresh while Files verifies for over sixty seconds and replays",
  async (effect) => {
    const result = await runRetentionScenario(effect, "success");
    expect(result.result).toEqual({ status: "completed" });
    expect(result.fileCalls).toBe(1);
    expect(result.effects).toBe(1);
    expect(result.elapsed).toBeGreaterThan(60_000);
    expect(result.observations).toBeGreaterThanOrEqual(4);
    expect(result.completions).toEqual([effect]);
    expect(result.finishes).toEqual(["completed"]);
  },
  120_000,
);

test.each(["provider_failure", "intent_changed", "cancelled"] as const)(
  "scoped retention %s settles cancellation before returning and replays",
  async (mode) => {
    const result = await runRetentionScenario("purge", mode);
    expect(result.result).toEqual(
      mode === "cancelled"
        ? { cancelled: true }
        : {
            status: "waiting",
            reason: "movie_retention_refresh_failed_requires_reconciliation",
          },
    );
    expect(result.fileCalls).toBe(1);
    expect(result.effects).toBe(0);
    expect(result.cancelled).toBe(true);
    expect(result.completions).toEqual([]);
    expect(result.finishes).toEqual(["reconciling"]);
  },
  60_000,
);

test.each(["quarantine", "purge"] as const)(
  "an obsolete scoped %s completion stops before further file effects and replays",
  async (effect) => {
    const result = await runRetentionScenario(effect, "completion_obsolete");
    expect(result.result).toEqual({
      status: "obsolete",
      reason: "selected_completion_obsolete",
    });
    expect(result.fileCalls).toBe(1);
    expect(result.effects).toBe(1);
    expect(result.completions).toEqual([effect]);
    expect(result.finishes).toEqual(["completed"]);
  },
  120_000,
);

test.each(["protected", "obsolete"] as const)(
  "an initial scoped %s result finishes with the correct durable operation state",
  async (status) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const finishes: { status: string; reason: string | null }[] = [];
    const workflowWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const networkWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        evaluateMovieRetentionV4: () => ({
          status,
          decisionId: null,
          wakeAt: null,
          reason: "selected_cut_protected",
        }),
        finishMediaOperation: (input: {
          status: string;
          reason: string | null;
        }) => {
          finishes.push(input);
        },
      },
    });
    const running = networkWorker.run();
    try {
      const handle = await environment.client.workflow.start(
        "retainMovieEditionV4Workflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [retentionInput],
        },
      );
      expect(await workflowWorker.runUntil(handle.result())).toEqual({
        status: status === "protected" ? "waiting" : "obsolete",
        reason: "selected_cut_protected",
      });
      expect(finishes).toMatchObject([
        {
          status: status === "protected" ? "reconciling" : "completed",
          reason: "selected_cut_protected",
        },
      ]);
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      networkWorker.shutdown();
      await running;
      await environment.teardown();
    }
  },
  60_000,
);

test("warning/grace/quarantine durable timers retain scope and continue-as-new never finishes intermediate work", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let observations = 0;
  let quarantined = false;
  let purged = false;
  const finishes: string[] = [];
  const completions: string[] = [];
  const starts: number[] = [];
  const evaluate: MovieNetworkActivitiesV4["evaluateMovieRetentionV4"] = async (
    input,
  ) => {
    expect(input).toEqual(retentionInput);
    observations++;
    if (purged)
      return {
        status: "complete",
        decisionId: null,
        wakeAt: null,
        reason: null,
      };
    const time = await environment.currentTimeMs();
    starts.push(time);
    if (observations <= 100)
      return {
        status: observations === 1 ? "warning" : "grace",
        decisionId: null,
        wakeAt: new Date(
          time + (observations === 1 ? 7 * 86_400_000 : 1000),
        ).toISOString(),
        reason: null,
      };
    return {
      status: quarantined ? "purge" : "quarantine",
      decisionId: "993cff6c-454e-4e1d-9390-3cb9f690c461",
      wakeAt: new Date(time + 7 * 86_400_000).toISOString(),
      reason: null,
    };
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
        const stage = purged ? "purged" : "quarantined";
        expect(input).toEqual({
          schemaVersion: 4,
          operationId: retentionInput.operationId,
          decisionId: "993cff6c-454e-4e1d-9390-3cb9f690c461",
          scope: retentionInput.scope,
          stage,
        });
        expect(quarantined).toBe(true);
        expect(finishes).toEqual([]);
        completions.push(stage);
        return { status: "completed", reason: null };
      },
      finishMediaOperation: (input: { status: string }) => {
        finishes.push(input.status);
      },
    },
  });
  const fileWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      quarantineMovieFilesV4: () => {
        quarantined = true;
        return { status: "quarantined" };
      },
      purgeMovieFilesV4: () => {
        purged = true;
        return { status: "purged" };
      },
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
        args: [retentionInput],
      },
    );
    expect(await workflowWorker.runUntil(handle.result())).toEqual({
      status: "completed",
    });
    expect(observations).toBe(102);
    expect(completions).toEqual(["quarantined", "purged"]);
    expect(
      (starts[1] ?? -Infinity) - (starts[0] ?? Infinity),
    ).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(finishes).toEqual(["completed"]);
    const initialHistory = await environment.client.workflow
      .getHandle(handle.workflowId, handle.firstExecutionRunId)
      .fetchHistory();
    expect(
      initialHistory.events?.some(
        (event) => event.workflowExecutionContinuedAsNewEventAttributes != null,
      ),
    ).toBe(true);
    await Worker.runReplayHistory({ workflowsPath }, initialHistory);
    const latest = environment.client.workflow.getHandle(handle.workflowId);
    await Worker.runReplayHistory(
      { workflowsPath },
      await latest.fetchHistory(),
    );
  } finally {
    networkWorker.shutdown();
    fileWorker.shutdown();
    await Promise.all([networkRun, fileRun]);
    await environment.teardown();
  }
}, 60_000);
