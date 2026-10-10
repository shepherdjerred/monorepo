import { execFileSync } from "node:child_process";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { describe, expect, test } from "vitest";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runWorkflowWithActivityWorker } from "./test-support.ts";

describe("beta daily notification canary", () => {
  test("executes attention and recovery reports through the beta reports queue", async () => {
    const environment = await TestWorkflowEnvironment.createLocal({
      server: {
        namespace: "beta",
        executable: {
          type: "existing-path",
          path: execFileSync("mise", ["which", "temporal"], {
            encoding: "utf8",
          }).trim(),
        },
      },
    });
    try {
      const reports: ActivityReportInput[] = [];
      await runWorkflowWithActivityWorker(environment, {
        namespace: "beta",
        activityTaskQueue: TASK_QUEUES.REPORTS,
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activities: {
          deliverActivityReport: (input: ActivityReportInput) => {
            reports.push(input);
          },
        },
        execute: async () => {
          for (const condition of ["attention", "clear"] as const) {
            await environment.client.workflow.execute(
              "runDailyNotificationCanary",
              {
                args: [{ condition }],
                workflowId: `notification-canary-${crypto.randomUUID()}`,
                taskQueue: TASK_QUEUES.WORKFLOWS,
              },
            );
          }
          await expect(
            environment.client.workflow.execute("runDailyNotificationCanary", {
              args: [{ condition: "invalid" }],
              workflowId: `notification-canary-invalid-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
            }),
          ).rejects.toThrow("Workflow execution failed");
        },
      });
      expect(reports).toHaveLength(2);
      expect(reports[0]).toMatchObject({
        scheduleId: "daily-notification-policy-canary",
        reportType: "daily-notification-policy-canary",
        verdict: "attention",
        findings: [{ id: "notification-canary-condition", state: "active" }],
      });
      expect(reports[1]).toMatchObject({ verdict: "clear", findings: [] });
      expect(reports[0]?.evidence[0]?.excerpt).toBe(
        JSON.stringify({ condition: "attention" }),
      );
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("rejects another namespace before attempting report delivery", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const reports: ActivityReportInput[] = [];
    try {
      await expect(
        runWorkflowWithActivityWorker(environment, {
          activityTaskQueue: TASK_QUEUES.REPORTS,
          workflowPath: new URL("index.ts", import.meta.url).pathname,
          activities: {
            deliverActivityReport: (input: ActivityReportInput) => {
              reports.push(input);
            },
          },
          execute: () =>
            environment.client.workflow.execute("runDailyNotificationCanary", {
              args: [{ condition: "attention" }],
              workflowId: `notification-canary-wrong-namespace-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
            }),
        }),
      ).rejects.toThrow("Workflow execution failed");
      expect(reports).toEqual([]);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
