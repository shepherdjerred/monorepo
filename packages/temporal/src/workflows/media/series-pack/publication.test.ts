import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { assertPrivateHistory } from "#activities/media/testing/history.ts";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { Context } from "@temporalio/activity";
import type { WorkflowHandle } from "@temporalio/client";

const currentPath = new URL("../core.ts", import.meta.url).pathname;
const previousPath = new URL(
  "fixtures/acquisition-before-prepare.ts",
  import.meta.url,
).pathname;
type Mode =
  | "prepared"
  | "blocked"
  | "obsolete"
  | "legacy"
  | "physical-blocked"
  | "seal-blocked"
  | "plex-blocked"
  | "plex-timeout"
  | "rollback-protected"
  | "rollback-obsolete"
  | "rollback-cancelled"
  | "invalid-cursor"
  | "cancelled";

async function cancelWhenStarted(
  mode: Mode,
  started: Promise<void>,
  handle: WorkflowHandle,
) {
  if (mode !== "cancelled" && mode !== "rollback-cancelled") return;
  await started;
  await handle.cancel();
}

async function workflowCompletion(mode: Mode, handle: WorkflowHandle) {
  try {
    return await handle.result();
  } catch (error) {
    if (mode === "invalid-cursor") {
      expect(error).toMatchObject({
        cause: { type: "SeriesPackProtocolError", nonRetryable: true },
      });
      return { status: "failed" };
    }
    if (mode !== "cancelled" && mode !== "rollback-cancelled") throw error;
    return { status: "cancelled" };
  }
}

function assertFileBudgets(
  history: Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>,
) {
  for (const event of history.events ?? []) {
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (
      !scheduled?.activityType?.name ||
      ![
        "prepareSeriesPackPublication",
        "prepareSeriesPackMembersPublicationV1",
        "sealSeriesPackPublicationIntentV1",
        "publishSeriesPackMembersV1",
        "sealSeriesPackPublicationOutcomeV1",
        "compensateSeriesPackMembersV1",
        "sealSeriesPackCompensationV1",
        "rollbackPublishedSeriesPackV1",
      ].includes(scheduled.activityType.name)
    )
      continue;
    expect(scheduled.taskQueue?.name).toBe(TASK_QUEUES.MEDIA_FILES);
    expect(Number(scheduled.startToCloseTimeout?.seconds?.toString())).toBe(
      43_200,
    );
    expect(Number(scheduled.scheduleToCloseTimeout?.seconds?.toString())).toBe(
      315_360_000,
    );
    expect(Number(scheduled.heartbeatTimeout?.seconds?.toString())).toBe(60);
    expect(scheduled.retryPolicy?.maximumAttempts).toBe(3);
  }
}

function networkWorker(
  environment: TestWorkflowEnvironment,
  mode: Mode,
  calls: string[],
  rollback: { completed: boolean },
) {
  return Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      publishRolledBackMedia: () => {
        if (rollback.completed) calls.push("verify-rollback");
        return Promise.resolve({
          status: rollback.completed ? "available" : "not_applicable",
          reason: null,
        });
      },
      observeMediaAcquisition: () =>
        Promise.resolve({
          status: "ready",
          reason: mode === "legacy" ? null : "series_pack_publication_v1",
        }),
      publishMediaToPlex: () => {
        calls.push("plex");
        if (mode === "plex-timeout")
          return Promise.resolve({ status: "waiting", reason: null });
        if (
          [
            "plex-blocked",
            "rollback-protected",
            "rollback-obsolete",
            "rollback-cancelled",
          ].includes(mode)
        )
          return Promise.resolve({
            status: "blocked",
            reason: "original_part_identity_mismatch",
          });
        return Promise.resolve({ status: "available", reason: null });
      },
      finalizeMediaAcquisition: () => {
        calls.push("finalize");
        return Promise.resolve();
      },
      finishMediaOperation: (value: {
        status: string;
        reason: string | null;
      }) => {
        calls.push(`finish:${value.status}:${String(value.reason)}`);
        return Promise.resolve();
      },
    },
  });
}

async function scenario(mode: Mode, workflowsPath = currentPath) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const input = {
    operationId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    submitted: true,
  };
  const calls: string[] = [];
  const rollback = { completed: false };
  let signalPhysicalStarted: (() => void) | undefined;
  const physicalStarted = new Promise<void>((resolve) => {
    signalPhysicalStarted = resolve;
  });
  const network = await networkWorker(environment, mode, calls, rollback);
  const files = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    maxHeartbeatThrottleInterval: "10 milliseconds",
    activities: {
      stageSeriesPackMembersV1: (raw: unknown) => {
        expect(raw).toEqual({
          operationId: input.operationId,
          attemptId: input.attemptId,
          batchIndex: 0,
        });
        calls.push("stage-batch:0");
        return Promise.resolve({
          status: "staged",
          receiptId: input.operationId,
          nextBatchIndex: null,
        });
      },
      sealSeriesPackStagingV1: () => {
        calls.push("seal-staging");
        return Promise.resolve({ status: "staged" });
      },
      inspectAndStageMedia: () => {
        calls.push("inspect");
        return Promise.resolve({ status: "staged" });
      },
      prepareSeriesPackPublication: (raw: unknown) => {
        expect(raw).toEqual({
          operationId: input.operationId,
          attemptId: input.attemptId,
        });
        calls.push("prepare");
        return Promise.resolve(
          mode === "blocked" || mode === "obsolete"
            ? { status: mode, reason: "pack_preparation_protected" }
            : { status: "prepared" },
        );
      },
      prepareSeriesPackMembersPublicationV1: (raw: { batchIndex: number }) => {
        expect(raw).toEqual({
          operationId: input.operationId,
          attemptId: input.attemptId,
          batchIndex: raw.batchIndex,
        });
        calls.push(`prepare-batch:${String(raw.batchIndex)}`);
        if (mode === "blocked" || mode === "obsolete")
          return Promise.resolve({
            status: mode,
            reason: "pack_preparation_protected",
          });
        return Promise.resolve({
          status: "prepared",
          receiptId: input.operationId,
          nextBatchIndex:
            mode === "invalid-cursor"
              ? 2
              : raw.batchIndex === 5
                ? null
                : raw.batchIndex + 1,
        });
      },
      sealSeriesPackPublicationIntentV1: () => {
        calls.push("seal-intent");
        return Promise.resolve({ status: "prepared" });
      },
      publishSeriesPackMembersV1: async (raw: { batchIndex: number }) => {
        calls.push(`publish-batch:${String(raw.batchIndex)}`);
        if (mode === "cancelled") {
          const activity = Context.current();
          const heartbeat = setInterval(() => activity.heartbeat(), 10);
          signalPhysicalStarted?.();
          try {
            return await activity.cancelled;
          } finally {
            clearInterval(heartbeat);
            calls.push("physical-settled");
          }
        }
        if (mode === "physical-blocked" && raw.batchIndex === 1)
          return {
            status: "blocked",
            reason: "physical_protected",
          };
        return {
          status: "published",
          receiptId: input.operationId,
          nextBatchIndex: raw.batchIndex === 5 ? null : raw.batchIndex + 1,
        };
      },
      sealSeriesPackPublicationOutcomeV1: () => {
        calls.push("seal-outcome");
        return Promise.resolve(
          mode === "seal-blocked"
            ? { status: "blocked", reason: "seal_protected" }
            : { status: "published" },
        );
      },
      compensateSeriesPackMembersV1: (raw: { batchIndex: number }) => {
        calls.push(`inverse-batch:${String(raw.batchIndex)}`);
        return Promise.resolve({
          status: "compensated",
          receiptId: input.operationId,
          nextBatchIndex: raw.batchIndex === 5 ? null : raw.batchIndex + 1,
        });
      },
      sealSeriesPackCompensationV1: () => {
        calls.push("seal-compensation");
        return Promise.resolve({ status: "compensated" });
      },
      promoteMediaFiles: () => {
        calls.push("promote");
        return Promise.resolve({ status: "published" });
      },
      rollbackPublishedSeriesPackV1: async (raw: unknown) => {
        expect(raw).toEqual({
          operationId: input.operationId,
          attemptId: input.attemptId,
        });
        calls.push("rollback-published-pack");
        if (mode === "rollback-cancelled") {
          const activity = Context.current();
          const heartbeat = setInterval(() => activity.heartbeat(), 10);
          signalPhysicalStarted?.();
          try {
            return await activity.cancelled;
          } finally {
            clearInterval(heartbeat);
            calls.push("rollback-settled");
          }
        }
        if (mode === "rollback-obsolete")
          return {
            status: "obsolete",
            reason: "scope_changed",
          };
        if (mode === "rollback-protected")
          return {
            status: "protected",
            reason: "successor_already_serving",
          };
        rollback.completed = true;
        return { status: "rolled_back" };
      },
      rollbackMediaPromotion: () => {
        throw new Error("A sealed v3 pack must use its own rollback authority");
      },
    },
  });
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const running = [network.run(), files.run()];
  try {
    const handle = await environment.client.workflow.start(
      "acquireMediaReleaseWorkflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [input],
      },
    );
    const cancel = cancelWhenStarted(mode, physicalStarted, handle);
    const result: unknown = await worker.runUntil(
      workflowCompletion(mode, handle),
    );
    await cancel;
    const history = await handle.fetchHistory();
    assertPrivateHistory(historyToJSON(history), [
      "private-provider-source",
      "fixture-private-token",
    ]);
    assertFileBudgets(history);
    await Worker.runReplayHistory({ workflowsPath: currentPath }, history);
    return { calls, result, history };
  } finally {
    network.shutdown();
    files.shutdown();
    await Promise.all(running);
    await environment.teardown();
  }
}

test("the actual new ready protocol prepares before publishing and replays with original Files budgets", async () => {
  const result = await scenario("prepared");
  expect(result.result).toEqual({ status: "completed" });
  expect(result.calls).toEqual([
    "stage-batch:0",
    "seal-staging",
    ...Array.from(
      { length: 6 },
      (_, index) => `prepare-batch:${String(index)}`,
    ),
    "seal-intent",
    ...Array.from(
      { length: 6 },
      (_, index) => `publish-batch:${String(index)}`,
    ),
    "seal-outcome",
    "plex",
    "finalize",
    "finish:completed:null",
  ]);
}, 60_000);

test.each(["blocked", "obsolete"] as const)(
  "%s preparation never reaches promotion or Plex",
  async (mode) => {
    const result = await scenario(mode);
    expect(result.result).toEqual({
      status: mode,
      reason: "pack_preparation_protected",
    });
    expect(result.calls).toEqual([
      "stage-batch:0",
      "seal-staging",
      "prepare-batch:0",
      `finish:${mode === "blocked" ? "reconciling" : "completed"}:pack_preparation_protected`,
    ]);
  },
  60_000,
);

test("the retained pre-prepare acquisition body replays with no new Activity or patch marker", async () => {
  const result = await scenario("legacy", previousPath);
  expect(result.calls).toEqual([
    "inspect",
    "promote",
    "plex",
    "finalize",
    "finish:completed:null",
  ]);
  expect(result.result).toEqual({ status: "completed" });
  expect(
    result.history.events?.some(
      (event) =>
        event.markerRecordedEventAttributes?.markerName === "core_patch",
    ),
  ).toBe(false);
}, 60_000);

test.each(["physical-blocked", "seal-blocked"] as const)(
  "%s completes the actual inverse cursor before finishing protected",
  async (mode) => {
    const result = await scenario(mode);
    expect(result.result).toEqual({
      status: "blocked",
      reason:
        mode === "physical-blocked" ? "physical_protected" : "seal_protected",
    });
    expect(result.calls).not.toContain("plex");
    expect(result.calls.slice(-8)).toEqual([
      ...Array.from(
        { length: 6 },
        (_, index) => `inverse-batch:${String(index)}`,
      ),
      "seal-compensation",
      `finish:reconciling:${mode === "physical-blocked" ? "physical_protected" : "seal_protected"}`,
    ]);
  },
  60_000,
);

test("a noncontiguous preparation cursor fails the actual Workflow without granting publication and replays", async () => {
  const result = await scenario("invalid-cursor");
  expect(result.result).toEqual({ status: "failed" });
  expect(result.calls).toEqual([
    "stage-batch:0",
    "seal-staging",
    "prepare-batch:0",
    "finish:reconciling:acquisition_failed",
  ]);
}, 60_000);

test("cancellation waits for physical settlement before running the noncancelled whole inverse and replays", async () => {
  const result = await scenario("cancelled");
  expect(result.result).toEqual({ status: "cancelled" });
  expect(result.calls.indexOf("physical-settled")).toBeGreaterThan(
    result.calls.indexOf("publish-batch:0"),
  );
  expect(result.calls.indexOf("inverse-batch:0")).toBeGreaterThan(
    result.calls.indexOf("physical-settled"),
  );
  expect(result.calls.slice(-2)).toEqual([
    "seal-compensation",
    "finish:reconciling:acquisition_cancelled",
  ]);
  expect(result.calls).not.toContain("plex");
}, 60_000);

test.each(["plex-blocked", "plex-timeout"] as const)(
  "%s rolls back only the actual sealed pack, rechecks playback and replays",
  async (mode) => {
    const result = await scenario(mode);
    const reason =
      mode === "plex-blocked"
        ? "original_part_identity_mismatch"
        : "plex_publication_unconfirmed";
    expect(result.result).toEqual({ status: "blocked", reason });
    expect(result.calls.filter((call) => call === "plex")).toHaveLength(
      mode === "plex-timeout" ? 30 : 1,
    );
    expect(result.calls.slice(-3)).toEqual([
      "rollback-published-pack",
      "verify-rollback",
      `finish:reconciling:${reason}`,
    ]);
    expect(result.calls).not.toContain("finalize");
    expect(result.calls).not.toContain("seal-compensation");
  },
  60_000,
);

test.each(["rollback-protected", "rollback-obsolete"] as const)(
  "%s preserves the scoped rollback result without claiming restored playback",
  async (mode) => {
    const result = await scenario(mode);
    const obsolete = mode === "rollback-obsolete";
    const reason = obsolete ? "scope_changed" : "successor_already_serving";
    expect(result.result).toEqual({
      status: obsolete ? "obsolete" : "blocked",
      reason,
    });
    expect(result.calls.slice(-2)).toEqual([
      "rollback-published-pack",
      `finish:${obsolete ? "completed" : "reconciling"}:${reason}`,
    ]);
    expect(result.calls).not.toContain("verify-rollback");
    expect(result.calls).not.toContain("finalize");
  },
  60_000,
);

test("cancellation during committed rollback waits for Files settlement before closing the coordinator and replays", async () => {
  const result = await scenario("rollback-cancelled");
  expect(result.result).toEqual({ status: "cancelled" });
  expect(result.calls.slice(-2)).toEqual([
    "rollback-settled",
    "finish:reconciling:acquisition_cancelled",
  ]);
  expect(result.calls).not.toContain("verify-rollback");
  expect(result.calls).not.toContain("finalize");
}, 60_000);
