import { ScheduleOverlapPolicy } from "@temporalio/client";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutFixedScheduleId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import {
  scoutPipelineReconciliationInputCodec,
  scoutPostMatchDiscoveryInputCodec,
  scoutPrematchDiscoveryInputCodec,
} from "@scout-for-lol/temporal/workflow-contracts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-types.ts";

const CATCHUP_TIGHT = "5 minutes";
const CATCHUP_RELAXED = "1 hour";
// A game-start announcement is worth nothing late, so a prematch poll the
// server missed by more than a minute is skipped rather than replayed.
const CATCHUP_LIVE = "1 minute";

const INITIAL_PAUSE_NOTE =
  "Paused until the matching Scout Temporal feature family is enabled and legacy work is drained";

// The text is persisted in live schedule state, which is how reconciliation
// recognises the pause as its own; do not reword it.
const CRAWL_PAUSE_NOTE =
  "Paused until the Scout beta worker bundle exports scoutParticipantCrawlWorkflow and the crawl is enabled";

const CRAWL_FRONTIER_PRUNE_PAUSE_NOTE =
  "Paused until the Scout worker bundle exports scoutCrawlFrontierPruneWorkflow and the crawl is enabled";

const RANK_REFRESH_PAUSE_NOTE =
  "Paused until the Scout worker bundle exports scoutRankRefreshWorkflow and the rank refresh is enabled";

// Reconciliation clears the crawl's created pause in both stages: both worker
// bundles export the workflow, and the activity is a no-op until the
// `scout-participant-crawl-enabled` flag is on for that stage.
const CRAWL_RETIRED_PAUSE_NOTES = [CRAWL_PAUSE_NOTE];

// The crawl frontier prune and every other Scout schedule's migration pauses
// are retired on beta only. Production keeps them until its crawl is enabled.
const BETA_RETIRED_PAUSE_NOTES = [
  CRAWL_PAUSE_NOTE,
  CRAWL_FRONTIER_PRUNE_PAUSE_NOTE,
  RANK_REFRESH_PAUSE_NOTE,
  INITIAL_PAUSE_NOTE,
  "Paused until the matching Scout Temporal feature family is enabled",
];

type ScoutInterval =
  | "20 seconds"
  | "30 seconds"
  | "1 minute"
  | "5 minutes"
  | "15 minutes"
  | "1 hour";

type ScoutSchedule = {
  readonly name: string;
  readonly workflowType: string;
  readonly args: unknown[];
};

type ScoutIntervalSchedule = ScoutSchedule & {
  readonly every: ScoutInterval;
  readonly catchupWindow?: "1 minute" | "5 minutes" | "1 hour";
  readonly offset?: "5 minutes";
  readonly initiallyActive?: true;
  /** Created paused in every stage, with this note. */
  readonly pauseNote?: string;
  /** Reconciliation clears `pauseNote` in every stage, not on beta only. */
  readonly clearsPauseInEveryStage?: true;
};

type ScoutCronSchedule = ScoutSchedule & {
  readonly expression: string;
  readonly timezone?: string;
  readonly catchupWindow?: "1 hour" | "12 hours";
  /** Created paused in every stage, with this note, until an enablement PR clears it. */
  readonly pauseNote?: string;
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
    ...(stage === "beta"
      ? { retiredPauseNotes: BETA_RETIRED_PAUSE_NOTES }
      : schedule.clearsPauseInEveryStage === true
        ? { retiredPauseNotes: CRAWL_RETIRED_PAUSE_NOTES }
        : {}),
    ...(schedule.pauseNote === undefined
      ? stage === "beta" || schedule.initiallyActive
        ? {}
        : { initialPauseNote: INITIAL_PAUSE_NOTE }
      : { initialPauseNote: schedule.pauseNote }),
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
    ...(stage === "beta"
      ? { retiredPauseNotes: BETA_RETIRED_PAUSE_NOTES }
      : {}),
    ...(schedule.pauseNote === undefined
      ? stage === "beta"
        ? {}
        : { initialPauseNote: INITIAL_PAUSE_NOTE }
      : { initialPauseNote: schedule.pauseNote }),
  };
}

function schedulesForStage(stage: ScoutStage): ScheduleDefinition[] {
  return [
    intervalSchedule(stage, {
      name: "prematch-poll",
      // Live-game detection, with the prematch maintenance sweeps at the end
      // of each poll.
      workflowType: SCOUT_WORKFLOW_NAMES.prematchDiscovery,
      args: [scoutPrematchDiscoveryInputCodec.serialize({ stage })],
      every: "30 seconds",
      catchupWindow: CATCHUP_LIVE,
    }),
    intervalSchedule(stage, {
      name: "postmatch-discovery",
      workflowType: SCOUT_WORKFLOW_NAMES.postMatchDiscovery,
      args: [
        scoutPostMatchDiscoveryInputCodec.serialize({
          stage,
          trigger: "schedule",
        }),
      ],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      // Schedules deploy with the central worker, independently of the Scout
      // images, so nothing orders this schedule's first tick after the routed
      // bundle exports the workflow. It is created paused in both stages and
      // reconciliation clears the pause in both. The crawl itself stays a
      // no-op in a stage until its flag is on there.
      pauseNote: CRAWL_PAUSE_NOTE,
      clearsPauseInEveryStage: true,
      name: "participant-crawl",
      workflowType: SCOUT_WORKFLOW_NAMES.participantCrawl,
      args: [{ stage, trigger: "schedule" }],
      every: "1 minute",
      catchupWindow: CATCHUP_LIVE,
    }),
    intervalSchedule(stage, {
      // Bounds the crawl's work queue (`CrawlFrontier`). It ships paused for
      // the same reason as the crawl: the schedule deploys with the central
      // worker, independently of the Scout images that export the Workflow.
      pauseNote: CRAWL_FRONTIER_PRUNE_PAUSE_NOTE,
      name: "crawl-frontier-prune",
      workflowType: SCOUT_WORKFLOW_NAMES.crawlFrontierPrune,
      args: [{ stage, trigger: "schedule" }],
      every: "15 minutes",
      catchupWindow: CATCHUP_RELAXED,
    }),
    intervalSchedule(stage, {
      name: "ingestion-reconciliation",
      workflowType: "scoutIngestionReconciliationWorkflow",
      args: [{ stage, trigger: "schedule" }],
      every: "1 minute",
    }),
    intervalSchedule(stage, {
      name: "pipeline-reconciliation-v2",
      workflowType: SCOUT_WORKFLOW_NAMES.pipelineReconciliation,
      args: [
        scoutPipelineReconciliationInputCodec.serialize({
          stage,
          trigger: "schedule",
        }),
      ],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      name: "notification-intent-expiry",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "notification-intent-expiry" }],
      every: "5 minutes",
      catchupWindow: CATCHUP_TIGHT,
    }),
    intervalSchedule(stage, {
      name: "mvp-tally-refresh",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "mvp-tally-refresh" }],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
      // MVP voting is already live. This schedule repairs requests lost by a
      // gateway restart and does not switch ingestion ownership.
      initiallyActive: true,
    }),
    intervalSchedule(stage, {
      name: "support-inbox",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "support-inbox" }],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
      initiallyActive: true,
    }),
    intervalSchedule(stage, {
      name: "competition-refresh",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "competition-refresh" }],
      every: "15 minutes",
    }),
    intervalSchedule(stage, {
      name: "clash-snapshot",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "clash-snapshot" }],
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
      name: "progression-reconciliation",
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage, kind: "progression-reconciliation" }],
      every: "1 minute",
      catchupWindow: CATCHUP_TIGHT,
      initiallyActive: true,
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
      // Refreshes the current rank of tracked players with no rank evidence in
      // the last seven days. Riot calls run at backfill priority on the
      // background queue, as the other backfills do. It ships paused for the
      // same reason as the crawl: the schedule deploys with the central worker,
      // independently of the Scout images that export the Workflow. The
      // `scout-rank-refresh-enabled` flag is the kill switch.
      pauseNote: RANK_REFRESH_PAUSE_NOTE,
      name: "rank-refresh",
      workflowType: SCOUT_WORKFLOW_NAMES.rankRefresh,
      args: [{ stage, trigger: "schedule" }],
      expression: "0 5 * * *",
      catchupWindow: "12 hours",
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
  ];
}

export const SCOUT_SCHEDULES: ScheduleDefinition[] = [
  ...schedulesForStage("beta"),
  ...schedulesForStage("prod"),
];
