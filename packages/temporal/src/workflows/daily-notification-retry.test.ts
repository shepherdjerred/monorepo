import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { notificationDeliveryHarness } from "#activities/reports/notification-test-support.ts";
import {
  deliverDailyNotification,
  usesDailyNotificationPolicy,
} from "#activities/reports/report-notification-policy.ts";
import {
  activityReportRunId,
  type ActivityReportInput,
} from "#activities/reports/report-delivery.ts";
import type { ScoutQueueWindowsResult } from "#activities/scout/scout-queue-windows.ts";
import type { TasknotesCanaryResult } from "#activities/maintenance/tasknotes-canary.ts";
import { ReportEnvelopeV1Schema } from "#shared/reports/report.ts";
import { REPORT_SEND_CLAIM_TAKEOVER_MS } from "#shared/reports/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runWorkflowWithActivityWorker } from "./test-support.ts";

const queueResult: ScoutQueueWindowsResult = {
  changedFiles: [],
  branchName: undefined,
  commitHash: undefined,
  prUrl: undefined,
  autoMergeRequested: false,
  autoMergeConfigured: undefined,
  editCount: 0,
  warningCount: 0,
  warningSummaries: [],
  warningFingerprint: "d".repeat(64),
  warningConsecutiveRuns: 0,
  editSummaries: [],
  outcome: "no-diff",
};

const tasknotesResult: TasknotesCanaryResult = {
  observedAt: "2026-10-10T00:00:00.000Z",
  engine: { configSource: "vault", tasks: 100, skippedFiles: [] },
  pods: [],
  baseline: undefined,
  evidence: { pods: "{}", baseline: undefined },
};

test.each([
  {
    workflow: "runCiIoTelemetry",
    queue: TASK_QUEUES.INFRA,
    changedCondition: true,
  },
  {
    workflow: "runScoutQueueWindowsWatch",
    queue: TASK_QUEUES.SCOUT,
    changedCondition: true,
  },
  {
    workflow: "runTasknotesCanary",
    queue: TASK_QUEUES.INFRA,
    changedCondition: false,
  },
])(
  "$workflow recovers a fast send failure after the delivery lease expires",
  async ({ workflow, queue, changedCondition }) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const harness = notificationDeliveryHarness();
    const attempts: { number: number; startedAt: number }[] = [];
    const domainWorker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: queue,
      activities: {
        collectCiIoObservability: () => [
          {
            id: "telemetry",
            query: "up",
            minimumRequiredSeries: 1,
            series: 1,
            values: [1],
            passed: true,
          },
        ],
        refreshScoutQueueWindows: () => queueResult,
        collectTasknotesCanary: () => tasknotesResult,
      },
    });
    const domainRun = domainWorker.run();
    try {
      await runWorkflowWithActivityWorker(environment, {
        activityTaskQueue: TASK_QUEUES.REPORTS,
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activities: {
          deliverActivityReport: async (input: ActivityReportInput) => {
            const info = Context.current().info;
            const execution = info.workflowExecution;
            if (execution === undefined)
              throw new Error("Missing workflow execution");
            const startedAt = await environment.currentTimeMs();
            attempts.push({ number: info.attempt, startedAt });
            harness.faults.failSend = info.attempt === 1;
            const report = ReportEnvelopeV1Schema.parse({
              ...input,
              schemaVersion: 1,
              reportRunId: activityReportRunId(
                input.reportType,
                execution.runId,
                input.execution,
              ),
              completedAt: new Date(startedAt).toISOString(),
              provenance: {
                ...input.provenance,
                workflowId: execution.workflowId,
                runId: execution.runId,
              },
            });
            const dependencies = harness.deps(
              new Date(startedAt).toISOString(),
              `attempt-${String(info.attempt)}`,
            );
            return usesDailyNotificationPolicy(report)
              ? deliverDailyNotification(report, dependencies)
              : dependencies.deliver(report);
          },
        },
        execute: () =>
          environment.client.workflow.execute(workflow, {
            args: [],
            taskQueue: TASK_QUEUES.WORKFLOWS,
            workflowId: `notification-retry-${crypto.randomUUID()}`,
          }),
      });
      expect(attempts.map((attempt) => attempt.number)).toEqual([1, 2, 3]);
      const first = attempts[0],
        last = attempts[2];
      if (first === undefined || last === undefined)
        throw new Error("Missing retry attempts");
      expect(last.startedAt - first.startedAt).toBeGreaterThanOrEqual(
        REPORT_SEND_CLAIM_TAKEOVER_MS,
      );
      expect(harness.sent).toHaveLength(1);
      expect(harness.observations.size).toBe(changedCondition ? 1 : 0);
      if (changedCondition) {
        expect(
          [...harness.families.values()][0]?.value.pending,
        ).toBeUndefined();
        expect(
          [...harness.families.values()][0]?.value.lastAccepted,
        ).toBeDefined();
      }
    } finally {
      domainWorker.shutdown();
      await domainRun;
      await environment.teardown();
    }
  },
  60_000,
);
