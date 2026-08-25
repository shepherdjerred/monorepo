import { ScheduleOverlapPolicy } from "@temporalio/client";
import { scoutFixedScheduleId, type ScoutStage } from "@scout-for-lol/temporal";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

const CATCHUP_TIGHT = "5 minutes";
const CATCHUP_RELAXED = "1 hour";

const INITIAL_PAUSE_NOTE =
  "Paused until the matching Scout Temporal feature family is enabled and legacy work is drained";

type ScoutInterval =
  "20 seconds" | "30 seconds" | "1 minute" | "15 minutes" | "1 hour";

function scoutWorkflowTaskQueue(stage: ScoutStage) {
  return stage === "beta" ? TASK_QUEUES.SCOUT_BETA : TASK_QUEUES.SCOUT_PROD;
}

function intervalSchedule(
  stage: ScoutStage,
  name: string,
  workflowType: string,
  args: unknown[],
  every: ScoutInterval,
  catchupWindow: "5 minutes" | "1 hour" = CATCHUP_RELAXED,
  offset?: "5 minutes",
): ScheduleDefinition {
  return {
    id: scoutFixedScheduleId(stage, name),
    workflowType,
    args,
    timing: {
      kind: "interval",
      every,
      ...(offset === undefined ? {} : { offset }),
    },
    taskQueue: scoutWorkflowTaskQueue(stage),
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow,
    memo: `Scout ${stage} ${name}`,
    initialPauseNote: INITIAL_PAUSE_NOTE,
  };
}

function cronSchedule(
  stage: ScoutStage,
  name: string,
  workflowType: string,
  args: unknown[],
  expression: string,
  timezone = "UTC",
): ScheduleDefinition {
  return {
    id: scoutFixedScheduleId(stage, name),
    workflowType,
    args,
    timing: {
      kind: "cron",
      expression,
      timezone,
    },
    taskQueue: scoutWorkflowTaskQueue(stage),
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: CATCHUP_RELAXED,
    memo: `Scout ${stage} ${name}`,
    initialPauseNote: INITIAL_PAUSE_NOTE,
  };
}

function schedulesForStage(stage: ScoutStage): ScheduleDefinition[] {
  return [
    intervalSchedule(
      stage,
      "prematch-poll",
      "scoutRealtimePollWorkflow",
      [{ stage, kind: "prematch", maximumAgeSeconds: 90 }],
      "30 seconds",
      CATCHUP_TIGHT,
    ),
    intervalSchedule(
      stage,
      "tournament-lobby-poll",
      "scoutRealtimePollWorkflow",
      [{ stage, kind: "tournament-lobbies", maximumAgeSeconds: 60 }],
      "20 seconds",
      CATCHUP_TIGHT,
    ),
    intervalSchedule(
      stage,
      "postmatch-discovery",
      "scoutPostMatchDiscoveryWorkflow",
      [{ stage }],
      "1 minute",
      CATCHUP_TIGHT,
    ),
    intervalSchedule(
      stage,
      "ingestion-reconciliation",
      "scoutIngestionReconciliationWorkflow",
      [{ stage, trigger: "schedule" }],
      "1 minute",
    ),
    intervalSchedule(
      stage,
      "competition-refresh",
      "scoutBackgroundJobWorkflow",
      [{ stage, kind: "competition-refresh" }],
      "15 minutes",
    ),
    intervalSchedule(
      stage,
      "competition-validation",
      "scoutBackgroundJobWorkflow",
      [{ stage, kind: "competition-validation" }],
      "1 hour",
    ),
    intervalSchedule(
      stage,
      "report-schedule-reconciler",
      "scoutReportScheduleReconcilerWorkflow",
      [{ stage }],
      "1 minute",
    ),
    intervalSchedule(
      stage,
      "report-lake-fold",
      "scoutReportLakeWorkflow",
      [{ stage, kind: "fold" }],
      "15 minutes",
      CATCHUP_RELAXED,
      "5 minutes",
    ),
    cronSchedule(
      stage,
      "report-lake-rebuild",
      "scoutReportLakeWorkflow",
      [{ stage, kind: "rebuild" }],
      "0 2 * * *",
    ),
    cronSchedule(
      stage,
      "player-pruning",
      "scoutBackgroundJobWorkflow",
      [{ stage, kind: "player-pruning" }],
      "0 3 * * *",
    ),
    cronSchedule(
      stage,
      "removed-guild-cleanup",
      "scoutBackgroundJobWorkflow",
      [{ stage, kind: "removed-guild-cleanup" }],
      "0 4 * * *",
    ),
    cronSchedule(
      stage,
      "match-time-rebuild",
      "scoutBackgroundJobWorkflow",
      [{ stage, kind: "match-time-rebuild" }],
      "0 */6 * * *",
    ),
    cronSchedule(
      stage,
      "outreach",
      "scoutBackgroundJobWorkflow",
      [{ stage, kind: "outreach" }],
      "0 10 * * *",
    ),
    cronSchedule(
      stage,
      "conversion-check",
      "scoutBackgroundJobWorkflow",
      [{ stage, kind: "conversion-check" }],
      "30 10 * * *",
    ),
  ];
}

export const SCOUT_SCHEDULES: ScheduleDefinition[] = [
  ...schedulesForStage("beta"),
  ...schedulesForStage("prod"),
];
