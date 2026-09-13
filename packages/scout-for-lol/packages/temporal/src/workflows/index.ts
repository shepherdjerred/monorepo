import type {
  InteractiveOutcome,
  ScoutBackgroundJobInput,
  ScoutDetachedWorkInput,
  ScoutIngestionReconciliationInput,
  ScoutInitialHistoryInput,
  ScoutInteractiveRunInput,
  ScoutMatchIngestionInput,
  ScoutPostMatchDiscoveryInput,
  ScoutQueueCanaryInput,
  ScoutQueueCanaryProbeResult,
  ScoutRealtimePollInput,
  ScoutReportLakeInput,
  ScoutReportRunInput,
  ScoutReportScheduleReconcilerInput,
  ScoutWorkflowStatus,
  ScoutHallBaselineInput,
  ScoutChallengeRunRecomputeInput,
  ScoutDuelSeriesInput,
} from "#src/contracts.ts";
import type {
  ScoutLakeProjectionV2InputEnvelope,
  ScoutLakeProjectionV2ResultEnvelope,
  ScoutMatchProcessingV2InputEnvelope,
  ScoutMatchProcessingV2ResultEnvelope,
  ScoutNotificationV2InputEnvelope,
  ScoutNotificationV2ResultEnvelope,
  ScoutPipelineReconciliationV2InputEnvelope,
  ScoutPipelineReconciliationV2ResultEnvelope,
  ScoutPostMatchDiscoveryV2InputEnvelope,
  ScoutPostMatchDiscoveryV2ResultEnvelope,
  ScoutPrematchDiscoveryV2InputEnvelope,
  ScoutPrematchDiscoveryV2ResultEnvelope,
  ScoutPrematchGameV2InputEnvelope,
  ScoutPrematchGameV2ResultEnvelope,
  ScoutRecoveryBatchV2InputEnvelope,
  ScoutRecoveryBatchV2ResultEnvelope,
} from "#src/workflow-contracts-v2.ts";
import { scoutRealtimePollWorkflow as realtimePoll } from "./realtime.ts";
import { scoutMatchIngestionWorkflow as matchIngestion } from "./realtime.ts";
import { scoutPostMatchDiscoveryWorkflow as postMatchDiscovery } from "./realtime.ts";
import { scoutInitialHistoryWorkflow as initialHistory } from "./background.ts";
import { scoutIngestionReconciliationWorkflow as ingestionReconciliation } from "./background.ts";
import { scoutBackgroundJobWorkflow as backgroundJob } from "./background.ts";
import { scoutDetachedWorkWorkflow as detachedWork } from "./background.ts";
import { scoutReportLakeWorkflow as reportLake } from "./reports.ts";
import { scoutReportRunWorkflow as reportRun } from "./reports.ts";
import { scoutReportScheduleReconcilerWorkflow as reportScheduleReconciler } from "./reports.ts";
import { scoutInteractiveRunWorkflow as interactiveRun } from "./interactive.ts";
import { scoutQueueCanaryWorkflow as queueCanary } from "./canary.ts";
import {
  scoutChallengeRunRecomputeWorkflow as challengeRunRecompute,
  scoutDuelSeriesWorkflow as duelSeries,
  scoutHallBaselineWorkflow as hallBaseline,
} from "./progression.ts";
import {
  scoutMatchProcessingV2Workflow as matchProcessingV2,
  scoutPostMatchDiscoveryV2Workflow as postMatchDiscoveryV2,
} from "./match-v2.ts";
import {
  scoutPrematchDiscoveryV2Workflow as prematchDiscoveryV2,
  scoutPrematchGameV2Workflow as prematchGameV2,
} from "./prematch-v2.ts";
import {
  scoutLakeProjectionV2Workflow as lakeProjectionV2,
  scoutNotificationV2Workflow as notificationV2,
  scoutPipelineReconciliationV2Workflow as pipelineReconciliationV2,
  scoutRecoveryBatchV2Workflow as recoveryBatchV2,
} from "./durable-v2.ts";

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

export async function scoutDetachedWorkWorkflow(
  input: ScoutDetachedWorkInput,
): Promise<ScoutWorkflowStatus> {
  return await detachedWork(input);
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

export async function scoutQueueCanaryWorkflow(
  input: ScoutQueueCanaryInput,
): Promise<ScoutQueueCanaryProbeResult[]> {
  return await queueCanary(input);
}

export async function scoutHallBaselineWorkflow(
  input: ScoutHallBaselineInput,
): Promise<ScoutWorkflowStatus> {
  return await hallBaseline(input);
}

export async function scoutChallengeRunRecomputeWorkflow(
  input: ScoutChallengeRunRecomputeInput,
): Promise<ScoutWorkflowStatus> {
  return await challengeRunRecompute(input);
}

export async function scoutDuelSeriesWorkflow(
  input: ScoutDuelSeriesInput,
): Promise<ScoutWorkflowStatus> {
  return await duelSeries(input);
}

export async function scoutPostMatchDiscoveryV2Workflow(
  input: ScoutPostMatchDiscoveryV2InputEnvelope,
): Promise<ScoutPostMatchDiscoveryV2ResultEnvelope> {
  return await postMatchDiscoveryV2(input);
}

export async function scoutMatchProcessingV2Workflow(
  input: ScoutMatchProcessingV2InputEnvelope,
): Promise<ScoutMatchProcessingV2ResultEnvelope> {
  return await matchProcessingV2(input);
}

export async function scoutPrematchDiscoveryV2Workflow(
  input: ScoutPrematchDiscoveryV2InputEnvelope,
): Promise<ScoutPrematchDiscoveryV2ResultEnvelope> {
  return await prematchDiscoveryV2(input);
}

export async function scoutPrematchGameV2Workflow(
  input: ScoutPrematchGameV2InputEnvelope,
): Promise<ScoutPrematchGameV2ResultEnvelope> {
  return await prematchGameV2(input);
}

export async function scoutNotificationV2Workflow(
  input: ScoutNotificationV2InputEnvelope,
): Promise<ScoutNotificationV2ResultEnvelope> {
  return await notificationV2(input);
}

export async function scoutLakeProjectionV2Workflow(
  input: ScoutLakeProjectionV2InputEnvelope,
): Promise<ScoutLakeProjectionV2ResultEnvelope> {
  return await lakeProjectionV2(input);
}

export async function scoutRecoveryBatchV2Workflow(
  input: ScoutRecoveryBatchV2InputEnvelope,
): Promise<ScoutRecoveryBatchV2ResultEnvelope> {
  return await recoveryBatchV2(input);
}

export async function scoutPipelineReconciliationV2Workflow(
  input: ScoutPipelineReconciliationV2InputEnvelope,
): Promise<ScoutPipelineReconciliationV2ResultEnvelope> {
  return await pipelineReconciliationV2(input);
}
