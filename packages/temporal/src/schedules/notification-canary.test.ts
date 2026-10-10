import { expect, test } from "vitest";
import { usesDailyNotificationPolicy } from "#activities/reports/report-notification-policy.ts";
import { notificationCanaryReport } from "#activities/reports/notification-canary-report.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { SCHEDULES } from "./schedule-definitions.ts";
import { buildScheduleState } from "./schedule-state.ts";

test("declares the beta notification canary paused for explicit acceptance", () => {
  const schedule = SCHEDULES.find(
    (candidate) => candidate.id === "daily-notification-policy-canary",
  );
  expect(schedule).toMatchObject({
    namespace: "beta",
    workflowType: "runDailyNotificationCanary",
    taskQueue: TASK_QUEUES.WORKFLOWS,
    args: [{ condition: "attention" }],
  });
  expect(buildScheduleState(schedule ?? {}, {})).toMatchObject({
    paused: true,
    note: "Operator-triggered notification acceptance; keep recurring delivery paused",
  });
  expect(
    usesDailyNotificationPolicy(
      notificationCanaryReport(
        { condition: "attention" },
        "2026-10-09T00:00:00Z",
      ),
    ),
  ).toBe(true);
});
