import {
  ApplicationFailure,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";
import type { ReportDeliveryActivities } from "#activities/reports/report-delivery.ts";
import {
  notificationCanaryReport,
  NotificationCanaryInputSchema,
  type NotificationCanaryInput,
} from "#activities/reports/notification-canary-report.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const activities = proxyActivities<
  Pick<ReportDeliveryActivities, "deliverActivityReport">
>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
  retry: REPORT_DELIVERY_ACTIVITY_RETRY,
});

export async function runDailyNotificationCanary(
  input: NotificationCanaryInput,
): Promise<void> {
  if (workflowInfo().namespace !== "beta") {
    throw ApplicationFailure.nonRetryable(
      "Notification canary requires namespace beta",
      "WrongCanaryNamespace",
    );
  }
  const parsed = NotificationCanaryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      "Notification canary requires a condition of attention or clear",
      "InvalidCanaryInput",
    );
  }
  await activities.deliverActivityReport(
    notificationCanaryReport(parsed.data, new Date().toISOString()),
  );
}
