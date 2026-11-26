import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { GitBackupActivities } from "#activities/repo/git-backup.ts";
import type { GitBackupResult } from "#activities/repo/git-backup-report.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/reports/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runGitBackupWorkflow } from "./git-backup-workflow.ts";

describe("runGitBackupWorkflow", () => {
  test("dispatches runGitBackup onto repo-automation and delivers structured report onto reports queue", async () => {
    const testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const deliveredReports: ActivityReportInput[] = [];
      const fakeResult: GitBackupResult = {
        startedAt: "2026-11-25T10:00:00.000Z",
        completedAt: "2026-11-25T10:05:00.000Z",
        durationSeconds: 300,
        discoveredCount: 42,
        snapshottedCount: 3,
        unchangedCount: 39,
        failedCount: 0,
        prunedKeysCount: 2,
        repositories: [],
      };

      let attempts = 0;
      const repoActivities: GitBackupActivities = {
        runGitBackup: () => {
          attempts += 1;
          return attempts < 3
            ? Promise.reject(
                new Error(`worker pod recreate #${String(attempts)}`),
              )
            : Promise.resolve(fakeResult);
        },
      };
      const reportActivities: Pick<
        ReportDeliveryActivities,
        "deliverActivityReport"
      > = {
        deliverActivityReport: (input) => {
          deliveredReports.push(input);
          return Promise.resolve({
            outcome: "skipped",
            reason: "unchanged",
            reportRunId: "git-backup:run-1",
            reportType: "git-backup",
            scheduleId: "git-backup-daily",
            completedAt: "2026-11-25T10:05:01.000Z",
            observationKey: "obs/1",
          });
        },
      };

      const workflowWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath: new URL("../index.ts", import.meta.url).pathname,
      });
      const repoWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: TASK_QUEUES.REPO_AUTOMATION,
        activities: repoActivities,
      });
      const reportsWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: TASK_QUEUES.REPORTS,
        activities: reportActivities,
      });

      const outcome = await workflowWorker.runUntil(() =>
        repoWorker.runUntil(() =>
          reportsWorker.runUntil(() =>
            testEnv.client.workflow.execute(runGitBackupWorkflow, {
              taskQueue: TASK_QUEUES.WORKFLOWS,
              workflowId: "test-git-backup-daily",
            }),
          ),
        ),
      );

      expect(attempts).toBe(3);
      expect(outcome).toEqual(fakeResult);
      expect(deliveredReports).toHaveLength(1);
      expect(deliveredReports[0]).toMatchObject({
        reportType: "git-backup",
        scheduleId: "git-backup-daily",
        execution: "complete",
        verdict: "clear",
      });
    } finally {
      await testEnv.teardown();
    }
  }, 30_000);
});
