import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleSourceDefinition } from "./schedule-types.ts";

// Same window as CATCHUP_TIGHT in schedule-definitions.ts. Declared locally
// so this module does not import the registry that spreads it.
const CATCHUP_TIGHT = "5 minutes" as const;

function occupiedHeatSchedule(
  id: string,
  expression: string,
  memo: string,
): ScheduleSourceDefinition {
  return {
    id,
    workflowType: "applyClimateSchedule",
    args: [],
    timing: {
      kind: "cron",
      expression,
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "5 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo,
  };
}

/** Midnight setback, 08:00 day start, and 09:00 re-assert. Every day. */
export const CLIMATE_SCHEDULES: readonly ScheduleSourceDefinition[] = [
  occupiedHeatSchedule(
    "climate-sleep-setback",
    "0 0 * * *",
    "Occupied heat setback at midnight: bedroom 18°C, living-room heat off",
  ),
  occupiedHeatSchedule(
    "climate-day-start",
    "0 8 * * *",
    "Occupied heat day start at 08:00: living room and bedroom to 21°C",
  ),
  occupiedHeatSchedule(
    "climate-wake-reassert",
    "0 9 * * *",
    "Occupied heat re-assert at 09:00 if midnight or 08:00 was skipped",
  ),
];
