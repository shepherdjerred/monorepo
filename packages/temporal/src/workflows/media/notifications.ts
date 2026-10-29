import { sleep, proxyActivities } from "@temporalio/workflow";
import type {
  MediaNetworkActivities,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const writes = proxyActivities<
  Pick<MediaNetworkActivities, "deliverMediaNotification">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "5 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  retry: { maximumAttempts: 1 },
});
const lifecycle = proxyActivities<
  Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "5 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

export async function deliverMediaNotificationWorkflow(input: {
  operationId: string;
  notificationId: string;
}): Promise<MediaWorkflowResult> {
  const result = await deliverAndObserve(
    writes.deliverMediaNotification,
    input,
  );
  const status = result.status === "accepted" ? "completed" : "blocked";
  await lifecycle.finishMediaOperation({
    operationId: input.operationId,
    status: status === "completed" ? "completed" : "reconciling",
    reason: result.reason,
  });
  return {
    status,
    ...(result.reason === null ? {} : { reason: result.reason }),
  };
}

async function deliverAndObserve(
  deliver: MediaNetworkActivities["deliverMediaNotification"],
  input: Parameters<typeof deliver>[0],
) {
  let result = await deliver(input);
  // Accepted ledgers perform receipt-only reads; uncertain sends never repeat.
  for (
    let observation = 0;
    result.status === "accepted" && observation < 2;
    observation++
  ) {
    await sleep("1 minute");
    result = await deliver(input);
  }
  return result;
}
