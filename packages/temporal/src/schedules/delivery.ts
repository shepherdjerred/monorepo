import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

export const DELIVERY_DISPATCH_SCHEDULE: ScheduleDefinition = {
  namespace: "prod",
  id: "delivery-dispatch",
  workflowType: "deliveryDispatchWorkflow",
  args: [],
  timing: { kind: "interval", every: "1 minute" },
  taskQueue: TASK_QUEUES.DELIVERY_WORKFLOWS,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "5 minutes",
  catchupWindow: "5 minutes",
  initialPauseNote:
    "Awaiting Delivery service activation, executor credentials and compatible Workflow workers",
  memo: "Repair unacknowledged PostgreSQL delivery outbox rows with stable Workflow IDs",
};
