import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { WorkflowFailedError } from "@temporalio/client";
import { expect, test } from "vitest";
import {
  NativeCompensationActivityInputSchema,
  type NativeCompensationActivityInput,
} from "@shepherdjerred/media/native-compensation";
import type {
  SeriesPackNativeFileExecutionV1,
  SeriesPackNativeNetworkActivitiesV1,
} from "@shepherdjerred/media/native-series-pack-compensation";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import type { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  createSeriesPackNativeCompensationFileAdapterV1,
  createSeriesPackNativeCompensationNetworkAdapterV1,
} from "#activities/media/series-pack/native-compensation.ts";

const workflowsPath = new URL("../../index.ts", import.meta.url).pathname;
const workflows = {
  prepare: "prepareSeriesPackNativeCompensationV1Workflow",
  apply_lost_ack: "applySeriesPackNativeCompensationV1Workflow",
  compensate: "compensateSeriesPackNativePublicationV1Workflow",
  compensate_lost_ack: "compensateSeriesPackNativePublicationV1Workflow",
  playback: "compensateSeriesPackNativePublicationV1Workflow",
  refresh_failure: "compensateSeriesPackNativePublicationV1Workflow",
  publish_waiting: "publishSeriesPackNativeCompensationV1Workflow",
  publish_lost_ack: "publishSeriesPackNativeCompensationV1Workflow",
  publish30: "publishSeriesPackNativeCompensationV1Workflow",
} as const;
type Mode = keyof typeof workflows;
type FileRuntime = Awaited<
  ReturnType<
    Parameters<typeof createSeriesPackNativeCompensationFileAdapterV1>[0]
  >
>;
type NetworkRuntime = Awaited<
  ReturnType<
    Parameters<typeof createSeriesPackNativeCompensationNetworkAdapterV1>[0]
  >
>;
type Deferred = ReturnType<typeof Promise.withResolvers<undefined>>;
type Scenario = {
  mode: Mode;
  review: { planId: string; operationId: string };
  apply: { planId: string; operationId: string; planHash: string };
  effect: NativeCompensationActivityInput;
  planState: string;
  physicalState: Awaited<
    ReturnType<
      SeriesPackNativeNetworkActivitiesV1["seriesPackNativeCompensationStateV1"]
    >
  >["state"];
  verified: boolean;
  physicalCalls: number;
  publicationCalls: number;
  observations: number;
  physicalStarted: boolean;
  physicalDrained: boolean;
  settlementBeforeDrain: number;
  entered: Deferred;
  cancelled: Deferred;
  release: Deferred;
  finished: unknown[];
  calls: string[];
};

function scenario(mode: Mode): Scenario {
  const review = {
    planId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  };
  return {
    mode,
    review,
    apply: { ...review, planHash: "a".repeat(64) },
    effect: NativeCompensationActivityInputSchema.parse({
      schemaVersion: 1,
      continuationId: crypto.randomUUID(),
      operationId: review.operationId,
      recoveryEpoch: 2,
    }),
    planState: "preparing",
    physicalState: "pending",
    verified: false,
    physicalCalls: 0,
    publicationCalls: 0,
    observations: 0,
    physicalStarted: false,
    physicalDrained: false,
    settlementBeforeDrain: 0,
    finished: [],
    calls: [],
    entered: Promise.withResolvers<undefined>(),
    cancelled: Promise.withResolvers<undefined>(),
    release: Promise.withResolvers<undefined>(),
  };
}

function assertSdk(
  execution: SeriesPackNativeFileExecutionV1 | PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
  role: "files" | "network",
) {
  const sdk = Context.current();
  expect(sdk.info.taskQueue).toBe(
    role === "files" ? TASK_QUEUES.MEDIA_FILES : TASK_QUEUES.MEDIA_NETWORK,
  );
  expect(sdk.info.startToCloseTimeoutMs).toBe(
    role === "files" ? 43_200_000 : 120_000,
  );
  expect(sdk.info.scheduleToCloseTimeoutMs).toBe(
    role === "files" ? 90_000_000 : 300_000,
  );
  if (role === "files") expect(sdk.info.heartbeatTimeoutMs).toBe(60_000);
  expect(execution.signal).toBe(sdk.cancellationSignal);
  expect(execution.observed.wall).toBeLessThanOrEqual(Date.now());
  expect(execution.expiresAtMs).toBeLessThanOrEqual(
    Math.min(
      sdk.info.scheduledTimestampMs + sdk.info.scheduleToCloseTimeoutMs,
      sdk.info.currentAttemptScheduledTimestampMs +
        sdk.info.startToCloseTimeoutMs,
    ),
  );
  execution.assertActive();
  expect(budget.take).toBe(101);
  budget.consume(1);
}

function networkActivities(state: Scenario) {
  const facet: NetworkRuntime["seriesPackNativeCompensation"] = {
    observeSeriesPackNativeCompensationV1: (input, execution, budget) => {
      assertSdk(execution, budget, "network");
      // The real strict Review parser accepts no apply hash or queue envelope.
      expect(input).toEqual(state.review);
      state.observations++;
      return Promise.resolve();
    },
    seriesPackNativeCompensationStateV1: (input, execution, budget) => {
      assertSdk(execution, budget, "network");
      expect(input).toEqual(state.effect);
      if (state.physicalStarted && !state.physicalDrained)
        state.settlementBeforeDrain++;
      return Promise.resolve({
        state: state.physicalState,
        publicationVerified: state.verified,
      });
    },
    observeSeriesPackNativeCompensationExecutionV1: (
      input,
      execution,
      budget,
    ) => {
      assertSdk(execution, budget, "network");
      expect(input).toEqual(state.effect);
      state.observations++;
      if (state.mode === "refresh_failure" && state.physicalStarted) {
        state.calls.push("refresh-protected");
        return Promise.resolve({
          status: "protected",
          reason: "execution_authority_changed",
        });
      }
      return Promise.resolve(
        state.mode === "playback"
          ? {
              status: "protected",
              reason: "compensation_playback_active_or_unknown",
            }
          : { status: "ready", reason: null },
      );
    },
    publishSeriesPackNativeCompensationV1: (input, execution, budget) => {
      assertSdk(execution, budget, "network");
      expect(input).toEqual(state.effect);
      state.publicationCalls++;
      if (
        state.mode === "publish30" ||
        (state.mode === "publish_waiting" && state.publicationCalls === 1)
      )
        return Promise.resolve({
          status: "waiting",
          reason: "plex_scan_pending",
        });
      state.verified = true;
      if (state.mode === "publish_lost_ack")
        throw new Error("CAPABILITY_CANARY committed publication reply lost");
      return Promise.resolve({ status: "available", reason: null });
    },
  };
  return {
    ...createSeriesPackNativeCompensationNetworkAdapterV1(() =>
      Promise.resolve({ seriesPackNativeCompensation: facet }),
    ),
    nativeRecoveryState: (input: unknown) => {
      expect(input).toEqual(state.review);
      return Promise.resolve({
        state: state.planState,
        applied: state.planState === "applied",
      });
    },
    finishMediaOperation: (input: unknown) => {
      state.calls.push("finish");
      state.finished.push(input);
      if (state.mode === "refresh_failure")
        expect(state.physicalDrained).toBe(true);
      return Promise.resolve();
    },
  };
}

function fileActivities(state: Scenario) {
  const facet: FileRuntime["seriesPackNativeCompensation"] = {
    prepareSeriesPackNativeCompensationV1: (input, execution, budget) => {
      assertSdk(execution, budget, "files");
      expect(input).toEqual(state.review);
      state.physicalCalls++;
      state.planState = "awaiting_review";
      return Promise.resolve();
    },
    applySeriesPackNativeCompensationV1: (input, execution, budget) => {
      assertSdk(execution, budget, "files");
      expect(input).toEqual(state.apply);
      state.physicalCalls++;
      state.planState = "applied";
      throw new Error("CAPABILITY_CANARY applied review reply lost");
    },
    compensateSeriesPackNativePublicationV1: async (
      input,
      execution,
      budget,
    ) => {
      assertSdk(execution, budget, "files");
      expect(input).toEqual(state.effect);
      state.physicalCalls++;
      if (state.mode === "refresh_failure")
        return await drainPhysical(state, execution);
      state.physicalState = "compensated";
      state.physicalDrained = true;
      if (state.mode === "compensate_lost_ack")
        throw new Error("CAPABILITY_CANARY completed inverse reply lost");
      return { status: "compensated", reason: null };
    },
  };
  return createSeriesPackNativeCompensationFileAdapterV1(() =>
    Promise.resolve({ seriesPackNativeCompensation: facet }),
  );
}

async function drainPhysical(
  state: Scenario,
  execution: SeriesPackNativeFileExecutionV1,
): Promise<never> {
  state.physicalStarted = true;
  state.entered.resolve(undefined);
  try {
    while (!execution.signal.aborted) {
      await execution.checkpoint("routing-test-physical-in-flight");
      await Context.current().sleep(10);
    }
    await Context.current().cancelled;
    throw new Error("Cancelled physical Activity unexpectedly completed");
  } finally {
    state.calls.push(
      execution.signal.aborted ? "physical-cancelled" : "physical-failed",
    );
    state.cancelled.resolve(undefined);
    await state.release.promise;
    state.physicalDrained = true;
    state.calls.push("physical-drained");
  }
}

/** Activity outcomes are synthetic here; native Media producer/SQL acceptance is tested separately. */
test.each([
  "prepare",
  "apply_lost_ack",
  "compensate",
  "compensate_lost_ack",
  "playback",
  "refresh_failure",
  "publish_waiting",
  "publish_lost_ack",
  "publish30",
] as const)(
  "series-pack native compensation %s routes real SDK roles, drains and replays",
  async (mode) => {
    const state = scenario(mode);
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      const network = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: networkActivities(state),
      });
      workers.push(network);
      const files = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        maxHeartbeatThrottleInterval: 100,
        activities: fileActivities(state),
      });
      workers.push(files);
      const workflow = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath,
      });
      running.push(network.run(), files.run());
      const command =
        state.mode === "prepare"
          ? state.review
          : state.mode === "apply_lost_ack"
            ? state.apply
            : state.effect;
      const handle = await environment.client.workflow.start(
        workflows[state.mode],
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [{ ...command, kind: "queue-envelope-only" }],
        },
      );
      await workflow.runUntil(async () => {
        if (state.mode === "refresh_failure") {
          await state.entered.promise;
          await environment.sleep("31 seconds");
          await state.cancelled.promise;
          expect(state.finished).toEqual([]);
          expect(state.settlementBeforeDrain).toBe(0);
          expect(state.calls).toEqual([
            "refresh-protected",
            "physical-cancelled",
          ]);
          state.release.resolve(undefined);
          await expect(handle.result()).rejects.toBeInstanceOf(
            WorkflowFailedError,
          );
          await expect(handle.result()).rejects.toMatchObject({
            cause: {
              type: "SeriesPackCompensationEvidenceChanged",
              nonRetryable: true,
            },
          });
        } else await handle.result();
      });
      assertOutcome(state);
      const history = await handle.fetchHistory();
      expect(JSON.stringify(history)).not.toContain("CAPABILITY_CANARY");
      if (state.mode === "publish30") {
        const timers = (history.events ?? []).filter(
          (event) => event.timerFiredEventAttributes != null,
        );
        expect(timers).toHaveLength(30);
        expect(
          (history.events ?? []).filter(
            (event) =>
              event.activityTaskScheduledEventAttributes?.activityType?.name ===
              "publishSeriesPackNativeCompensationV1",
          ),
        ).toHaveLength(30);
      }
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      state.release.resolve(undefined);
      for (const worker of workers) worker.shutdown();
      await Promise.all(running);
      await environment.teardown();
    }
  },
  60_000,
);

function assertOutcome(state: Scenario) {
  const protectedMode =
    state.mode === "playback" ||
    state.mode === "refresh_failure" ||
    state.mode === "publish30";
  const reason =
    state.mode === "playback"
      ? "compensation_playback_active_or_unknown"
      : state.mode === "refresh_failure"
        ? "series_pack_native_compensation_execution_protected"
        : state.mode === "publish30"
          ? "series_pack_compensation_plex_verification_pending"
          : null;
  expect(state.finished).toEqual([
    {
      operationId: state.review.operationId,
      status: protectedMode ? "reconciling" : "completed",
      reason,
    },
  ]);
  if (
    state.mode === "prepare" ||
    state.mode === "compensate" ||
    state.mode === "refresh_failure"
  )
    expect(state.physicalCalls).toBe(1);
  if (state.mode === "apply_lost_ack" || state.mode === "compensate_lost_ack")
    expect(state.physicalCalls).toBe(2);
  if (state.mode === "playback" || state.mode.startsWith("publish"))
    expect(state.physicalCalls).toBe(0);
  if (state.mode === "publish_waiting" || state.mode === "publish_lost_ack")
    expect(state.publicationCalls).toBe(2);
  if (state.mode === "publish30") expect(state.publicationCalls).toBe(30);
  if (state.mode === "refresh_failure")
    expect(state.calls).toEqual([
      "refresh-protected",
      "physical-cancelled",
      "physical-drained",
      "finish",
    ]);
}
