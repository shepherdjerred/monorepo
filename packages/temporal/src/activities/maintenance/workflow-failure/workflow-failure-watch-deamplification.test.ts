import { describe, expect, it } from "vitest";
import { pollWorkflowFailuresOnce } from "./workflow-failure-watch.ts";
import {
  workflowExecutionKey,
  type WorkflowFailureWatchCheckpoint,
} from "./workflow-failure-watch-checkpoint.ts";
import {
  LOOKBACK_MS,
  NOW,
  TTL_MS,
  capturingPoster,
  clientForExecutions,
  dayTime,
  fakeClient,
  rejectWithApplicationFailure,
  scheduledAttributes,
  ttlEndsAt,
  type ExecutionInfo,
} from "./workflow-failure-watch-test-fixtures.ts";

describe("recurring schedule failure deduplication", () => {
  it("collapses 5 recurring schedule failures in 1h into 1 alert carrying newest run metadata and consuming 1 detail slot", async () => {
    const fiveRuns: ExecutionInfo[] = [
      "17:50",
      "17:35",
      "17:20",
      "17:05",
      "16:50",
    ].map((hhmm, index) => ({
      workflowId: `scout-poll-workflow-2026-07-30T${hhmm}:00Z`,
      runId: `run-sched-${String(index)}`,
      type: "scoutPollWorkflow",
      taskQueue: "scout",
      closeTime: dayTime(hhmm),
      status: { name: "FAILED" },
      typedSearchAttributes: scheduledAttributes("scout-poll"),
    }));
    const checkpoints: WorkflowFailureWatchCheckpoint[] = [];
    const client = clientForExecutions(fiveRuns, (index) =>
      rejectWithApplicationFailure(`failure-${String(index)}`),
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      namespace: "beta",
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
      onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    });

    expect(result).toEqual({
      scanned: 1,
      alerted: 1,
      errored: 0,
      overflowed: false,
    });
    expect(checkpoints.at(-1)?.detailedAlertsConsumed).toBe(1);
    const alerts = calls.flatMap((call) => call.alerts);
    expect(alerts).toHaveLength(1);
    const alert = alerts[0];
    expect(alert?.labels).toEqual({
      alertname: "TemporalWorkflowFailed",
      severity: "warning",
      workflowType: "scoutPollWorkflow",
      taskQueue: "scout",
      temporalNamespace: "beta",
      exported_namespace: "beta",
      schedule_id: "scout-poll",
    });
    expect(alert?.annotations["workflowId"]).toBe(
      "scout-poll-workflow-2026-07-30T17:50:00Z",
    );
    expect(alert?.annotations["runId"]).toBe("run-sched-0");
    expect(alert?.annotations["summary"]).toContain("failure-0");
    expect(alert?.generatorURL).toBe(
      "https://temporal-ui.tailnet-1a49.ts.net/namespaces/beta/workflows/scout-poll-workflow-2026-07-30T17%3A50%3A00Z/run-sched-0/history",
    );
    expect(alert?.endsAt).toBe(ttlEndsAt("17:50"));
  });

  it("resolves the single schedule_id alert with endsAt === startsAt once a Completed run closes after E_newest and >=2h elapses", async () => {
    const firingPollNow = dayTime("16:00");
    const recoveredPollNow = dayTime("18:00");
    const failedRuns: ExecutionInfo[] = ["15:50", "15:40", "15:30"].map(
      (hhmm, index) => ({
        workflowId: `scout-poll-workflow-2026-07-30T${hhmm}:00Z`,
        runId: `run-fail-${String(index)}`,
        type: "scoutPollWorkflow",
        taskQueue: "scout",
        closeTime: dayTime(hhmm),
        status: { name: "FAILED" },
        typedSearchAttributes: scheduledAttributes("scout-poll"),
      }),
    );
    const completedRun: ExecutionInfo = {
      workflowId: "scout-poll-workflow-2026-07-30T16:05:00Z",
      runId: "run-completed",
      type: "scoutPollWorkflow",
      taskQueue: "scout",
      closeTime: dayTime("16:05"),
      status: { name: "COMPLETED" },
      typedSearchAttributes: scheduledAttributes("scout-poll"),
    };
    const resolvers = Object.fromEntries(
      failedRuns.map((run) => [
        `${run.workflowId}/${run.runId}`,
        rejectWithApplicationFailure("transient error"),
      ]),
    );

    const firstCapture = capturingPoster();
    await pollWorkflowFailuresOnce(
      fakeClient(failedRuns, resolvers),
      firstCapture.poster,
      {
        now: firingPollNow,
        lookbackMs: LOOKBACK_MS,
        ttlMs: TTL_MS,
      },
    );
    const firingAlert = firstCapture.calls[0]?.alerts[0];
    expect(firingAlert?.endsAt).toBe(ttlEndsAt("15:50"));

    const secondCapture = capturingPoster();
    await pollWorkflowFailuresOnce(
      fakeClient([completedRun, ...failedRuns], resolvers),
      secondCapture.poster,
      {
        now: recoveredPollNow,
        lookbackMs: LOOKBACK_MS,
        ttlMs: TTL_MS,
      },
    );
    const resolvedAlerts = secondCapture.calls.flatMap((call) => call.alerts);
    expect(resolvedAlerts).toHaveLength(1);
    const resolvedAlert = resolvedAlerts[0];
    expect(resolvedAlert?.labels).toEqual(firingAlert?.labels);
    expect(resolvedAlert?.startsAt).toBe(recoveredPollNow.toISOString());
    expect(resolvedAlert?.endsAt).toBe(recoveredPollNow.toISOString());
  });
});

describe("Delivery state-machine exclusion and ad-hoc preservation", () => {
  it("retains workflowId and runId in labels alongside exported_namespace for ad-hoc workflows", async () => {
    const client = fakeClient(
      [
        {
          workflowId: "ad-hoc-backfill-7",
          runId: "run-adhoc-7",
          type: "syncGolinks",
          taskQueue: "default",
          closeTime: dayTime("17:50"),
          status: { name: "FAILED" },
        },
      ],
      {
        "ad-hoc-backfill-7/run-adhoc-7":
          rejectWithApplicationFailure("backfill failed"),
      },
    );
    const { poster, calls } = capturingPoster();

    await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    const alert = calls[0]?.alerts[0];
    expect(alert?.labels).toEqual({
      alertname: "TemporalWorkflowFailed",
      severity: "warning",
      workflowType: "syncGolinks",
      taskQueue: "default",
      temporalNamespace: "prod",
      exported_namespace: "prod",
      workflowId: "ad-hoc-backfill-7",
      runId: "run-adhoc-7",
    });
    expect(alert?.annotations["workflowId"]).toBeUndefined();
    expect(alert?.annotations["runId"]).toBeUndefined();
  });

  it("excludes deliveryDeploymentWorkflow and deliveryWorkerRecoveryWorkflow from detail and overflow while collapsing deliveryDispatchWorkflow", async () => {
    const excludedDeploymentRuns: ExecutionInfo[] = Array.from(
      { length: 105 },
      (_, index) => ({
        workflowId: `delivery/deploy-${String(index)}`,
        runId: `run-deploy-${String(index)}`,
        type:
          index % 2 === 0
            ? "deliveryDeploymentWorkflow"
            : "deliveryWorkerRecoveryWorkflow",
        taskQueue: "delivery-workflows",
        closeTime: new Date(NOW.getTime() - index * 1000),
        status: { name: "FAILED" },
      }),
    );
    const dispatchRuns: ExecutionInfo[] = ["17:55", "17:50"].map(
      (hhmm, index) => ({
        workflowId: `delivery-dispatch-workflow-2026-07-30T${hhmm}:00Z`,
        runId: `run-dispatch-${String(index)}`,
        type: "deliveryDispatchWorkflow",
        taskQueue: "delivery-workflows",
        closeTime: dayTime(hhmm),
        status: { name: "FAILED" },
        typedSearchAttributes: scheduledAttributes("delivery-dispatch"),
      }),
    );
    const client = clientForExecutions(
      [...dispatchRuns, ...excludedDeploymentRuns],
      () => rejectWithApplicationFailure("blocked target"),
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
    });

    expect(result).toEqual({
      scanned: 1,
      alerted: 1,
      errored: 0,
      overflowed: false,
    });
    const alerts = calls.flatMap((call) => call.alerts);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.labels).toEqual({
      alertname: "TemporalWorkflowFailed",
      severity: "warning",
      workflowType: "deliveryDispatchWorkflow",
      taskQueue: "delivery-workflows",
      temporalNamespace: "prod",
      exported_namespace: "prod",
      schedule_id: "delivery-dispatch",
    });
    expect(alerts[0]?.annotations["runId"]).toBe("run-dispatch-0");
  });

  it("skips older runs of an already-checkpointed recurring schedule on retry without overwriting or throwing", async () => {
    const newestClose = dayTime("17:50");
    const olderClose = dayTime("17:40");
    const executions: ExecutionInfo[] = [
      {
        workflowId: "scout-poll-workflow-2026-07-30T17:50:00Z",
        runId: "run-newest",
        type: "scoutPollWorkflow",
        taskQueue: "scout",
        closeTime: newestClose,
        status: { name: "FAILED" },
        typedSearchAttributes: scheduledAttributes("scout-poll"),
      },
      {
        workflowId: "scout-poll-workflow-2026-07-30T17:40:00Z",
        runId: "run-older",
        type: "scoutPollWorkflow",
        taskQueue: "scout",
        closeTime: olderClose,
        status: { name: "FAILED" },
        typedSearchAttributes: scheduledAttributes("scout-poll"),
      },
    ];
    const checkpoint: WorkflowFailureWatchCheckpoint = {
      detailedAlertsConsumed: 1,
      cursor: {
        closeTime: newestClose,
        startTime: newestClose,
        workflowId: "scout-poll-workflow-2026-07-30T17:50:00Z",
        runId: "run-newest",
        processedExecutionKeys: [
          workflowExecutionKey(
            "scout-poll-workflow-2026-07-30T17:50:00Z",
            "run-newest",
          ),
        ],
      },
    };
    const client = clientForExecutions(executions, () =>
      rejectWithApplicationFailure("poll failed"),
    );
    const { poster, calls } = capturingPoster();

    const result = await pollWorkflowFailuresOnce(client, poster, {
      now: NOW,
      lookbackMs: LOOKBACK_MS,
      ttlMs: TTL_MS,
      checkpoint,
    });

    expect(result).toEqual({
      scanned: 0,
      alerted: 0,
      errored: 0,
      overflowed: false,
    });
    expect(calls).toHaveLength(0);
  });
});
