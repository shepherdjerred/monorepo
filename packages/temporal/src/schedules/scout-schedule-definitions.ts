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

type ScoutSchedule = {
  readonly name: string;
  readonly workflowType: string;
  readonly args: unknown[];
};

type ScoutIntervalSchedule = ScoutSchedule & {
  readonly every: ScoutInterval;
  readonly catchupWindow?: "5 minutes" | "1 hour";
  readonly offset?: "5 minutes";
};

type ScoutCronSchedule = ScoutSchedule & {
  readonly expression: string;
  readonly timezone?: string;
  readonly catchupWindow?: "1 hour" | "12 hours";
};

function scoutWorkflowTaskQueue(stage: ScoutStage) {
  return stage === "beta" ? TASK_QUEUES.SCOUT_BETA : TASK_QUEUES.SCOUT_PROD;
}

function intervalSchedule(
  stage: ScoutStage,
  schedule: ScoutIntervalSchedule,
): ScheduleDefinition {
  return {
    namespace: stage,
    id: scoutFixedScheduleId(stage, schedule.name),
    workflowType: schedule.workflowType,
    args: schedule.args,
    timing: {
      kind: "interval",
      every: schedule.every,
      ...(schedule.offset === undefined ? {} : { offset: schedule.offset }),
    },
    taskQueue: scoutWorkflowTaskQueue(stage),
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: schedule.catchupWindow ?? CATCHUP_RELAXED,
    memo: `Scout ${stage} ${schedule.name}`,
    initialPauseNote: INITIAL_PAUSE_NOTE,
  };
}

function cronSchedule(
  stage: ScoutStage,
  schedule: ScoutCronSchedule,
): ScheduleDefinition {
  return {
    namespace: stage,
    id: scoutFixedScheduleId(stage, schedule.name),
    workflowType: schedule.workflowType,
    args: schedule.args,
    timing: {
      kind: "cron",
      expression: schedule.expression,
      timezone: schedule.timezone ?? "UTC",
    },
    taskQueue: scoutWorkflowTaskQueue(stage),
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: schedule.catchupWindow ?? CATCHUP_RELAXED,
    memo: `Scout ${stage} ${schedule.name}`,
    initialPauseNote: INITIAL_PAUSE_NOTE,
  };
}

function schedulesForStage(stage: ScoutStage): ScheduleDefinition[] {
  return [
    intervalSchedule(stage, {
      name: "prematch-poll",
      workflowType: "scoutRealtimePollWorkflow",
      args: [{ stage, kind: "prematch", maximumAgeSeconds: 90 }],
      every: "30 seconds",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      name: "tournament-lobby-poll",
      workflowType: "scoutRealtimePollWorkflow",
      args: [{ stage, kind: "tournament-lobbies", maximumAgeSeconds: 60 }],
      every: "20 seconds",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      name: "postmatch-discovery",
      workflowType: "scoutPostMatchDiscoveryWorkflow",
      args: [{ stage }],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      name: "ingestion-reconciliation",
      workflowType: "scoutIngestionReconciliationWorkflow",
      args: [{ stage, trigger: "schedule" }],
      every: "1 minute",
    }),
    ...(stage === "beta"
      ? [
          intervalSchedule(stage, {
            name: "custom-nights-expiry",
            workflowType: "scoutBackgroundJobWorkflow",
            args: [{ stage, kind: "custom-nights-expiry" }],
            every: "1 minute",
            catchupWindow: CATCHUP_TIGHT,
          }),
        ]
      : []),
    intervalSchedule(stage, {
      name: "competition-refresh",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "competition-refresh" }],
      every: "15 minutes",
    }),
    intervalSchedule(stage, {
      name: "competition-scheduled-updates",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "competition-scheduled-updates" }],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      name: "competition-validation",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "competition-validation" }],
      every: "1 hour",
    }),
    intervalSchedule(stage, {
      name: "summoner-index-backfill",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "summoner-index-backfill" }],
      every: "1 hour",
    }),
    intervalSchedule(stage, {
      name: "report-schedule-reconciler",
      workflowType: "scoutReportScheduleReconcilerWorkflow",
      args: [{ stage }],
      every: "1 minute",
    }),
    intervalSchedule(stage, {
      name: "progression-outbox",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "progression-outbox" }],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      name: "report-lake-fold",
      workflowType: "scoutReportLakeWorkflow",
      args: [{ stage, kind: "fold" }],
      every: "15 minutes",
      catchupWindow: CATCHUP_RELAXED,
      offset: "5 minutes",
    }),
    cronSchedule(stage, {
      name: "report-lake-rebuild",
      workflowType: "scoutReportLakeWorkflow",
      args: [{ stage, kind: "rebuild" }],
      expression: "0 2 * * *",
    }),
    cronSchedule(stage, {
      name: "player-pruning",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "player-pruning" }],
      expression: "0 3 * * *",
    }),
    cronSchedule(stage, {
      name: "removed-guild-cleanup",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "removed-guild-cleanup" }],
      expression: "0 4 * * *",
    }),
    cronSchedule(stage, {
      name: "match-time-rebuild",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "match-time-rebuild" }],
      expression: "0 */6 * * *",
    }),
    cronSchedule(stage, {
      name: "outreach",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "outreach" }],
      expression: "0 10 * * *",
    }),
    cronSchedule(stage, {
      name: "conversion-check",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "conversion-check" }],
      expression: "30 10 * * *",
    }),
    cronSchedule(stage, {
      name: "bucks-reconciliation",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "bucks-reconciliation" }],
      expression: "0 5 * * *",
    }),
    cronSchedule(stage, {
      name: "weekly-bucks-leaderboard",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "weekly-bucks-leaderboard" }],
      expression: "0 17 * * 5",
      timezone: "America/Los_Angeles",
      catchupWindow: "12 hours",
    }),
  ];
}

export const SCOUT_SCHEDULES: ScheduleDefinition[] = [
  ...schedulesForStage("beta"),
  ...schedulesForStage("prod"),
];
