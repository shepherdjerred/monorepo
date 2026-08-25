import type {
  InteractiveOutcome,
  ScoutBackgroundJobInput,
  ScoutIngestionReconciliationInput,
  ScoutInitialHistoryInput,
  ScoutInteractiveRunInput,
  ScoutMatchIngestionInput,
  ScoutPostMatchDiscoveryInput,
  ScoutRealtimePollInput,
  ScoutReportLakeInput,
  ScoutReportRunInput,
  ScoutReportScheduleReconcilerInput,
  ScoutWorkflowStatus,
} from "#src/contracts.ts";
import { scoutRealtimePollWorkflow as realtimePoll } from "./realtime.ts";
import { scoutMatchIngestionWorkflow as matchIngestion } from "./realtime.ts";
import { scoutPostMatchDiscoveryWorkflow as postMatchDiscovery } from "./realtime.ts";
import { scoutInitialHistoryWorkflow as initialHistory } from "./background.ts";
import { scoutIngestionReconciliationWorkflow as ingestionReconciliation } from "./background.ts";
import { scoutBackgroundJobWorkflow as backgroundJob } from "./background.ts";
import { scoutReportLakeWorkflow as reportLake } from "./reports.ts";
import { scoutReportRunWorkflow as reportRun } from "./reports.ts";
import { scoutReportScheduleReconcilerWorkflow as reportScheduleReconciler } from "./reports.ts";
import { scoutInteractiveRunWorkflow as interactiveRun } from "./interactive.ts";

export async function scoutRealtimePollWorkflow(
  input: ScoutRealtimePollInput,
): Promise<ScoutWorkflowStatus> {
  return await realtimePoll(input);
}

export async function scoutMatchIngestionWorkflow(
  input: ScoutMatchIngestionInput,
): Promise<ScoutWorkflowStatus> {
  return await matchIngestion(input);
}

export async function scoutPostMatchDiscoveryWorkflow(
  input: ScoutPostMatchDiscoveryInput,
): Promise<{ status: ScoutWorkflowStatus; childrenStarted: number }> {
  return await postMatchDiscovery(input);
}

export async function scoutInitialHistoryWorkflow(
  input: ScoutInitialHistoryInput,
): Promise<{ status: ScoutWorkflowStatus; pagesProcessed: number }> {
  return await initialHistory(input);
}

export async function scoutIngestionReconciliationWorkflow(
  input: ScoutIngestionReconciliationInput,
): Promise<ScoutWorkflowStatus> {
  return await ingestionReconciliation(input);
}

export async function scoutBackgroundJobWorkflow(
  input: ScoutBackgroundJobInput,
): Promise<ScoutWorkflowStatus> {
  return await backgroundJob(input);
}

export async function scoutReportLakeWorkflow(
  input: ScoutReportLakeInput,
): Promise<ScoutWorkflowStatus> {
  return await reportLake(input);
}

export async function scoutReportRunWorkflow(
  input: ScoutReportRunInput,
): Promise<ScoutWorkflowStatus> {
  return await reportRun(input);
}

export async function scoutReportScheduleReconcilerWorkflow(
  input: ScoutReportScheduleReconcilerInput,
): Promise<{ status: ScoutWorkflowStatus; processed: number }> {
  return await reportScheduleReconciler(input);
}

export async function scoutInteractiveRunWorkflow(
  input: ScoutInteractiveRunInput,
): Promise<InteractiveOutcome> {
  return await interactiveRun(input);
}
