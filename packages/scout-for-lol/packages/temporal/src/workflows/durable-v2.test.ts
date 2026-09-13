import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  scoutLakeProjectionV2InputCodec,
  scoutNotificationV2InputCodec,
  scoutPipelineReconciliationV2InputCodec,
  scoutRecoveryBatchV2InputCodec,
} from "#src/workflow-contracts-v2.ts";
import {
  scoutNotificationV2WorkflowId,
  scoutPipelineReconciliationV2WorkflowId,
} from "#src/identifiers.ts";
import {
  scoutLakeProjectionV2Workflow,
  scoutNotificationV2Workflow,
  scoutPipelineReconciliationV2Workflow,
  scoutRecoveryBatchV2Workflow,
} from "./index.ts";
import {
  batchInState,
  createLakeStore,
  createNotificationStore,
  createReconciliationStore,
  createRecoveryStore,
  emptyPending,
  instant,
  intentInState,
  INTENT_KEY,
  LAKE_MATCH_ID,
  LAKE_STAGING_MATCH_RECEIPT_KIND,
  RECOVERY_BATCH_ID,
  scoutV2LakeStubs,
  scoutV2NotificationStubs,
  scoutV2ReconciliationStubs,
  scoutV2RecoveryStubs,
} from "./durable-v2.test-fixtures.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

let environment: TestWorkflowEnvironment;
const workers = createScoutWorkerPool();
const stage = "dev" as const;

beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await workers.drain();
  await environment.teardown();
});

/**
 * One Workflow worker plus whichever Activity queues a scenario needs.
 *
 * The SDK refuses a second worker on a task queue already served in this
 * process, so each scenario registers a queue at most once and the behaviour
 * comes from the store the stubs close over — which is also what lets one
 * registration serve both a run that crashes and the run that replaces it.
 */
async function startWorkers(
  queues: Readonly<Partial<Record<"realtime" | "background" | "lake", object>>>,
): Promise<void> {
  await workers.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: "scout-dev",
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      maxConcurrentWorkflowTaskExecutions: 4,
    }),
  );
  for (const [queue, activities] of Object.entries(queues)) {
    await workers.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: `scout-dev-${queue}`,
        activities,
        maxConcurrentActivityTaskExecutions: 4,
      }),
    );
  }
}

async function notify(workflowId: string): Promise<unknown> {
  return await environment.client.workflow.execute(
    scoutNotificationV2Workflow,
    {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutNotificationV2InputCodec.serialize({
          stage,
          intentKey: INTENT_KEY,
        }),
      ],
    },
  );
}

describe("the V2 notification intent machine", () => {
  test("readies, renders once, sends, and records the delivery", async () => {
    const store = createNotificationStore();
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });

    const result = await notify("notification-happy");

    expect(store.calls).toEqual([
      "readNotificationIntentV2",
      "markNotificationReadyV2",
      "renderNotificationArtifactV2",
      "beginNotificationSendV2",
      "deliverNotificationV2",
      "recordNotificationOutcomeV2",
    ]);
    expect(store.sends).toHaveLength(1);
    expect(store.renders).toBe(1);
    expect(result).toMatchObject({
      data: { state: { kind: "delivered" }, attemptCount: 1 },
    });
  }, 60_000);

  test("commits the attempt nonce before the send and the outcome after it", async () => {
    const store = createNotificationStore();
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });
    await notify("notification-nonce-ordering");

    // The whole crash contract lives in this ordering: an attempt committed
    // before the request leaves is identifiable afterwards, an attempt
    // committed after it would be a gap.
    expect(store.calls.indexOf("beginNotificationSendV2")).toBeLessThan(
      store.calls.indexOf("deliverNotificationV2"),
    );
    expect(store.calls.indexOf("deliverNotificationV2")).toBeLessThan(
      store.calls.indexOf("recordNotificationOutcomeV2"),
    );
  }, 60_000);

  test("stops at unknown-delivery and never sends a second time", async () => {
    const store = createNotificationStore({ script: [{ outcome: "unknown" }] });
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });

    const result = await notify("notification-unknown");

    // One send, and the run completes rather than failing: an unobserved send
    // is a legitimate stopping point, and the retry that would resolve it is
    // exactly the retry that could tell a user the same thing twice.
    expect(store.sends).toHaveLength(1);
    expect(result).toMatchObject({
      data: { status: "completed", state: { kind: "unknown-delivery" } },
    });
  }, 60_000);

  test("resolves a send whose Activity never answered as unknown", async () => {
    const store = createNotificationStore({ script: [{ outcome: "throw" }] });
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });

    const result = await notify("notification-ambiguous");

    expect(store.sends).toHaveLength(1);
    expect(result).toMatchObject({
      data: { state: { kind: "unknown-delivery" } },
    });
  }, 60_000);

  test("retries a retryable failure under a fresh nonce, then stops", async () => {
    const store = createNotificationStore({
      script: [
        {
          outcome: "failed",
          failure: {
            classification: "retryable",
            reason: "service-unavailable",
          },
        },
      ],
    });
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });

    const result = await notify("notification-retryable");

    // Three attempts, each under its own nonce, because a retryable failure
    // returns the intent to `ready` and the machine is saying "try again".
    expect(store.sends).toHaveLength(3);
    expect(new Set(store.sends).size).toBe(3);
    // Rendering reuses committed output, so the retries cost nothing extra.
    expect(store.renders).toBe(1);
    expect(result).toMatchObject({ data: { state: { kind: "ready" } } });
  }, 90_000);

  test("stops at a terminal failure without retrying", async () => {
    const store = createNotificationStore({
      script: [
        {
          outcome: "failed",
          failure: { classification: "terminal", reason: "permission-denied" },
        },
      ],
    });
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });

    const result = await notify("notification-terminal");

    expect(store.sends).toHaveLength(1);
    expect(result).toMatchObject({
      data: { state: { kind: "permission-denied" } },
    });
  }, 60_000);

  test.each([
    {
      name: "delivered",
      state: {
        kind: "delivered" as const,
        deliveredAt: instant("2024-01-01T00:00:00.000Z"),
      },
    },
    {
      name: "suppressed",
      state: { kind: "suppressed" as const, reason: "stale" as const },
    },
    { name: "expired", state: { kind: "expired" as const } },
  ])(
    "does nothing to an intent already $name",
    async (scenario) => {
      const store = createNotificationStore({
        intent: intentInState(scenario.state, 1),
      });
      const stubs = scoutV2NotificationStubs(store);
      await startWorkers({ realtime: stubs, background: stubs });

      await notify(`notification-settled-${scenario.name}`);

      expect(store.calls).toEqual(["readNotificationIntentV2"]);
      expect(store.sends).toEqual([]);
      expect(store.renders).toBe(0);
    },
    60_000,
  );
});

describe("a V2 notification run that died mid-send", () => {
  test("resolves the abandoned attempt as unknown without re-sending", async () => {
    // The durable state a worker that died between committing the nonce and
    // recording the outcome leaves behind: an attempt in flight, owned by an
    // execution that is gone.
    const attemptNonce = "run-that-died:1";
    const store = createNotificationStore({
      intent: intentInState(
        {
          kind: "sending",
          attemptNonce: scoutAttemptNonce(attemptNonce),
          startedAt: instant("2024-01-01T00:00:00.000Z"),
        },
        1,
      ),
    });
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });

    const result = await notify("notification-resume-sending");

    // No send, no render, no second attempt: the replacement run's only honest
    // move is to record what nobody observed, against the exact nonce that
    // produced it.
    expect(store.calls).toEqual([
      "readNotificationIntentV2",
      "recordNotificationOutcomeV2",
    ]);
    expect(store.sends).toEqual([]);
    expect(result).toMatchObject({
      data: { state: { kind: "unknown-delivery", attemptNonce } },
    });
  }, 60_000);

  test("survives a crash between the nonce commit and the outcome", async () => {
    const store = createNotificationStore({
      failAt: "recordNotificationOutcomeV2",
    });
    const stubs = scoutV2NotificationStubs(store);
    await startWorkers({ realtime: stubs, background: stubs });

    await expect(notify("notification-crash")).rejects.toThrow();
    expect(store.sends).toHaveLength(1);

    // The replacement execution reads the intent the dead run left `sending`.
    store.failAt = null;
    const result = await notify("notification-crash-replay");

    // Still one send across both runs. That is the property the three-Activity
    // split exists to give: the attempt survived its Workflow.
    expect(store.sends).toHaveLength(1);
    expect(result).toMatchObject({
      data: { state: { kind: "unknown-delivery" } },
    });
  }, 90_000);
});

function scoutAttemptNonce(value: string) {
  // The fixture stores a domain-branded nonce; parsing here keeps the branded
  // type without exporting a second parser from the fixtures.
  return NotificationAttemptNonceSchema.parse(value);
}

describe("the V2 lake projection", () => {
  test("stages once and reports the receipt and file count", async () => {
    const store = createLakeStore();
    await startWorkers({ lake: scoutV2LakeStubs(store) });

    const result = await environment.client.workflow.execute(
      scoutLakeProjectionV2Workflow,
      {
        taskQueue: "scout-dev",
        workflowId: "lake-projection-happy",
        args: [
          scoutLakeProjectionV2InputCodec.serialize({
            stage,
            riotMatchId: LAKE_MATCH_ID,
          }),
        ],
      },
    );

    expect(store.calls).toEqual(["stageLakeProjectionV2"]);
    expect(result).toMatchObject({
      data: {
        status: "completed",
        riotMatchId: LAKE_MATCH_ID,
        receiptKinds: [LAKE_STAGING_MATCH_RECEIPT_KIND],
        stagedFileCount: 3,
      },
    });
  }, 60_000);

  test("retries a staging write that did not happen", async () => {
    // Strict, not fail-open: the door throws and records no receipt, so the
    // Activity's own retry policy is what gets the projection staged rather
    // than a result that quietly reports zero files.
    const store = createLakeStore({ failuresBeforeSuccess: 2 });
    await startWorkers({ lake: scoutV2LakeStubs(store) });

    const result = await environment.client.workflow.execute(
      scoutLakeProjectionV2Workflow,
      {
        taskQueue: "scout-dev",
        workflowId: "lake-projection-retry",
        args: [
          scoutLakeProjectionV2InputCodec.serialize({
            stage,
            riotMatchId: LAKE_MATCH_ID,
          }),
        ],
      },
    );

    expect(store.calls).toHaveLength(3);
    expect(result).toMatchObject({ data: { stagedFileCount: 3 } });
  }, 90_000);
});

async function recover(workflowId: string): Promise<unknown> {
  return await environment.client.workflow.execute(
    scoutRecoveryBatchV2Workflow,
    {
      taskQueue: "scout-dev",
      workflowId,
      args: [
        scoutRecoveryBatchV2InputCodec.serialize({
          stage,
          recoveryBatchId: RECOVERY_BATCH_ID,
        }),
      ],
    },
  );
}

describe("the V2 recovery batch", () => {
  test("scans, processes, digests and closes, reporting the tally it watched", async () => {
    const store = createRecoveryStore();
    await startWorkers({ background: scoutV2RecoveryStubs(store) });

    const result = await recover("recovery-full");

    expect(store.calls.at(0)).toBe("readRecoveryBatchV2");
    expect(store.calls).toContain("scanRecoveryPageV2");
    expect(store.calls).toContain("processRecoveryPageV2");
    expect(store.calls).toContain("digestRecoveryBatchV2");
    expect(store.calls.at(-1)).toBe("closeRecoveryBatchV2");
    expect(result).toMatchObject({
      data: {
        state: { kind: "complete" },
        counts: {
          kind: "observed",
          counts: { discovered: 6, succeeded: 6, suppressed: 0, failed: 0 },
        },
      },
    });
  }, 90_000);

  test("pages the scan rather than doing it in one call", async () => {
    const store = createRecoveryStore({
      remaining: 6,
      discovered: 6,
      pageSize: 2,
    });
    await startWorkers({ background: scoutV2RecoveryStubs(store) });

    await recover("recovery-paged");

    // Three scan pages for six items at two per page, and three process pages
    // for the same six. A batch that did either in one call would put an
    // unbounded amount of work behind a single Activity timeout.
    expect(
      store.calls.filter((call) => call === "scanRecoveryPageV2"),
    ).toHaveLength(3);
    expect(
      store.calls.filter((call) => call === "processRecoveryPageV2"),
    ).toHaveLength(3);
  }, 90_000);

  test("reports unobserved counts for a batch resumed past processing", async () => {
    // A sweep or an operator started this run onto a batch already digesting.
    // The row keeps count columns only while `processing`, so no read can
    // recover the tally — and reporting zeros would be indistinguishable from
    // a batch that genuinely found nothing.
    const store = createRecoveryStore({
      batch: batchInState({ kind: "digesting" }),
    });
    await startWorkers({ background: scoutV2RecoveryStubs(store) });

    const result = await recover("recovery-resumed");

    expect(store.calls).toEqual([
      "readRecoveryBatchV2",
      "closeRecoveryBatchV2",
    ]);
    expect(result).toMatchObject({
      data: { state: { kind: "complete" }, counts: { kind: "unobserved" } },
    });
  }, 60_000);

  test("does nothing to a batch that already closed", async () => {
    const store = createRecoveryStore({
      batch: batchInState({ kind: "abandoned", reason: "operator-cancelled" }),
    });
    await startWorkers({ background: scoutV2RecoveryStubs(store) });

    const result = await recover("recovery-closed");

    expect(store.calls).toEqual(["readRecoveryBatchV2"]);
    expect(result).toMatchObject({
      data: {
        state: { kind: "abandoned", reason: "operator-cancelled" },
        counts: { kind: "unobserved" },
      },
    });
  }, 60_000);
});

describe("V2 pipeline reconciliation", () => {
  test("scans until the page reports it is complete", async () => {
    const store = createReconciliationStore({
      pages: [emptyPending(), emptyPending(), emptyPending()],
    });
    await startWorkers({ background: scoutV2ReconciliationStubs(store) });

    const result = await environment.client.workflow.execute(
      scoutPipelineReconciliationV2Workflow,
      {
        taskQueue: "scout-dev",
        workflowId: scoutPipelineReconciliationV2WorkflowId(stage, "schedule"),
        args: [
          scoutPipelineReconciliationV2InputCodec.serialize({
            stage,
            trigger: "schedule",
          }),
        ],
      },
    );

    expect(store.scanned).toBe(3);
    expect(result).toMatchObject({
      data: { status: "completed", trigger: "schedule", pagesScanned: 3 },
    });
  }, 90_000);

  test("carries its trigger into both the Workflow ID and the scan", async () => {
    const store = createReconciliationStore();
    await startWorkers({ background: scoutV2ReconciliationStubs(store) });

    const workflowId = scoutPipelineReconciliationV2WorkflowId(
      stage,
      "gateway-ready",
    );
    // The trigger is part of the ID precisely so a gateway reconnect sweep
    // cannot be silently absorbed by the scheduled run already in flight.
    expect(workflowId).toBe(
      "scout-dev-pipeline-reconciliation-v2-gateway-ready",
    );

    const result = await environment.client.workflow.execute(
      scoutPipelineReconciliationV2Workflow,
      {
        taskQueue: "scout-dev",
        workflowId,
        args: [
          scoutPipelineReconciliationV2InputCodec.serialize({
            stage,
            trigger: "gateway-ready",
          }),
        ],
      },
    );

    expect(store.triggers).toEqual(["gateway-ready"]);
    expect(result).toMatchObject({ data: { trigger: "gateway-ready" } });
  }, 60_000);

  test("starts a notification child for a stalled intent it finds", async () => {
    const reconciliation = createReconciliationStore({
      pages: [{ ...emptyPending(), notifications: [INTENT_KEY] }],
    });
    const notification = createNotificationStore();
    const stubs = scoutV2NotificationStubs(notification);
    await startWorkers({
      realtime: stubs,
      background: { ...stubs, ...scoutV2ReconciliationStubs(reconciliation) },
    });

    const result = await environment.client.workflow.execute(
      scoutPipelineReconciliationV2Workflow,
      {
        taskQueue: "scout-dev",
        workflowId: scoutPipelineReconciliationV2WorkflowId(stage, "operator"),
        args: [
          scoutPipelineReconciliationV2InputCodec.serialize({
            stage,
            trigger: "operator",
          }),
        ],
      },
    );

    expect(result).toMatchObject({
      data: { childrenStarted: { notifications: 1 } },
    });
    // The child is abandoned, so the sweep does not wait for it. Its own ID is
    // what proves it was started against this intent.
    await environment.client.workflow
      .getHandle(scoutNotificationV2WorkflowId(stage, INTENT_KEY))
      .result();
    expect(notification.sends).toHaveLength(1);
  }, 90_000);
});
