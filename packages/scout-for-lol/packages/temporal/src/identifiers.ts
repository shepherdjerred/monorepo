import type { ScoutStage } from "./contracts.ts";

export const SCOUT_WORKFLOW_NAMES = {
  realtimePoll: "scoutRealtimePollWorkflow",
  postMatchDiscovery: "scoutPostMatchDiscoveryWorkflow",
  matchIngestion: "scoutMatchIngestionWorkflow",
  initialHistory: "scoutInitialHistoryWorkflow",
  ingestionReconciliation: "scoutIngestionReconciliationWorkflow",
  backgroundJob: "scoutBackgroundJobWorkflow",
  detachedWork: "scoutDetachedWorkWorkflow",
  reportLake: "scoutReportLakeWorkflow",
  reportRun: "scoutReportRunWorkflow",
  reportScheduleReconciler: "scoutReportScheduleReconcilerWorkflow",
  interactiveRun: "scoutInteractiveRunWorkflow",
  queueCanary: "scoutQueueCanaryWorkflow",
} as const;

export function scoutTaskQueues(stage: ScoutStage) {
  const prefix = `scout-${stage}`;
  return {
    workflow: prefix,
    realtime: `${prefix}-realtime`,
    interactive: `${prefix}-interactive`,
    background: `${prefix}-background`,
    lake: `${prefix}-lake`,
  } as const;
}

export function scoutInteractiveWorkflowId(
  stage: ScoutStage,
  kind: "explore" | "report-ai" | "manual-report",
  databaseRunId: string,
): string {
  return `scout-${stage}-${kind}-${databaseRunId}`;
}

export function scoutMatchWorkflowId(
  stage: ScoutStage,
  matchId: string,
): string {
  return `scout-${stage}-match-${matchId}`;
}

export function scoutInitialHistoryWorkflowId(
  stage: ScoutStage,
  puuid: string,
): string {
  return `scout-${stage}-history-${puuid}`;
}

export function scoutDetachedWorkWorkflowId(
  stage: ScoutStage,
  kind: "parlay-generation",
  workId: string,
): string {
  return `scout-${stage}-${kind}-${workId}`;
}

export function scoutReportScheduleReconcilerWorkflowId(
  stage: ScoutStage,
): string {
  return `scout-${stage}-report-schedule-reconciler`;
}

export function scoutReportScheduleId(
  stage: ScoutStage,
  reportId: string,
): string {
  return `scout-${stage}-report-${reportId}`;
}

export function scoutFixedScheduleId(stage: ScoutStage, name: string): string {
  return `scout-${stage}-${name}`;
}

export function scoutQueueCanaryWorkflowId(
  stage: ScoutStage,
  canaryId: string,
): string {
  return `scout-${stage}-canary-${canaryId}`;
}

export function scoutSchedulePrefix(stage: ScoutStage): string {
  return `scout-${stage}-report-`;
}
