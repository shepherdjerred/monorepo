import type { ScheduleOverlapPolicy } from "@temporalio/client";
import type { Duration } from "@temporalio/common";

export type CatchupWindow = "5 minutes" | "1 hour" | "12 hours";

export type ScheduleDefinition = {
  id: string;
  workflowType: string;
  args: unknown[];
  cronExpression: string;
  taskQueue: string;
  overlap: ScheduleOverlapPolicy;
  memo: string;
  workflowExecutionTimeout?: Duration;
  // Server-outage replay margin. Omit to inherit CATCHUP_RELAXED; set
  // CATCHUP_TIGHT on time-of-day home automation that should skip rather than
  // fire late. See the CATCHUP_* constants in schedule-definitions.ts.
  catchupWindow?: CatchupWindow;
  requiredEnvironment?: readonly string[];
  requiredPresentEnvironment?: readonly string[];
  initialPauseNote?: string;
};
