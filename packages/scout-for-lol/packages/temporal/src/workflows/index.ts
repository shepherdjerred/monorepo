import type {
  InteractiveOutcome,
  ScoutBackgroundJobInput,
  ScoutDetachedWorkInput,
  ScoutIngestionReconciliationInput,
  ScoutInitialHistoryInput,
  ScoutExploreHistoryInput,
  ScoutExploreHistoryResult,
  ScoutExploreTimelineInput,
  ScoutExploreTimelineResult,
  ScoutInteractiveRunInput,
  ScoutQueueCanaryInput,
  ScoutQueueCanaryProbeResult,
  ScoutReportLakeInput,
  ScoutReportRunInput,
  ScoutReportScheduleReconcilerInput,
  ScoutWorkflowStatus,
  ScoutHallBaselineInput,
  ScoutChallengeRunRecomputeInput,
  ScoutDuelSeriesInput,
} from "#src/contracts.ts";
import type {
  ScoutLakeProjectionInputEnvelope,
  ScoutLakeProjectionResultEnvelope,
  ScoutClientMatchDispatchInputEnvelope,
  ScoutMatchProcessingInputEnvelope,
  ScoutMatchProcessingResultEnvelope,
  ScoutNotificationInputEnvelope,
  ScoutNotificationResultEnvelope,
  ScoutPipelineReconciliationInputEnvelope,
  ScoutPipelineReconciliationResultEnvelope,
  ScoutPostMatchDiscoveryInputEnvelope,
  ScoutPostMatchDiscoveryResultEnvelope,
  ScoutPrematchDiscoveryInputEnvelope,
  ScoutPrematchDiscoveryResultEnvelope,
  ScoutPrematchGameInputEnvelope,
  ScoutPrematchGameResultEnvelope,
  ScoutRecoveryBatchInputEnvelope,
  ScoutRecoveryBatchResultEnvelope,
} from "#src/workflow-contracts.ts";
import type {
  ScoutSilentPostmatchBackfillInputEnvelope,
  ScoutSilentPostmatchBackfillResultEnvelope,
} from "#src/silent-postmatch-backfill.ts";
import { scoutInitialHistoryWorkflow as initialHistory } from "./background.ts";
import { scoutExploreHistoryWorkflow as exploreHistory } from "./background.ts";
import { scoutExploreTimelineWorkflow as exploreTimeline } from "./background.ts";
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
import { scoutClientMatchDispatchWorkflow as clientMatchDispatch } from "./client-match-dispatch.ts";
import {
  scoutMatchProcessingWorkflow as matchProcessing,
  scoutPostMatchDiscoveryWorkflow as postMatchDiscovery,
} from "./match.ts";
import {
  scoutPrematchDiscoveryWorkflow as prematchDiscovery,
  scoutPrematchGameWorkflow as prematchGame,
} from "./prematch.ts";
import {
  scoutLakeProjectionWorkflow as lakeProjection,
  scoutNotificationWorkflow as notification,
  scoutPipelineReconciliationWorkflow as pipelineReconciliation,
  scoutRecoveryBatchWorkflow as recoveryBatch,
} from "./durable.ts";
import { scoutSilentPostmatchBackfillWorkflow as silentPostmatchBackfill } from "./silent-postmatch-backfill.ts";

export async function scoutInitialHistoryWorkflow(
  input: ScoutInitialHistoryInput,
): Promise<{ status: ScoutWorkflowStatus; pagesProcessed: number }> {
  return await initialHistory(input);
}

export async function scoutExploreHistoryWorkflow(
  input: ScoutExploreHistoryInput,
): Promise<ScoutExploreHistoryResult> {
  return await exploreHistory(input);
}

export async function scoutExploreTimelineWorkflow(
  input: ScoutExploreTimelineInput,
): Promise<ScoutExploreTimelineResult> {
  return await exploreTimeline(input);
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

export async function scoutPostMatchDiscoveryWorkflow(
  input: ScoutPostMatchDiscoveryInputEnvelope,
): Promise<ScoutPostMatchDiscoveryResultEnvelope> {
  return await postMatchDiscovery(input);
}

export async function scoutMatchProcessingWorkflow(
  input: ScoutMatchProcessingInputEnvelope,
): Promise<ScoutMatchProcessingResultEnvelope> {
  return await matchProcessing(input);
}

export async function scoutClientMatchDispatchWorkflow(
  input: ScoutClientMatchDispatchInputEnvelope,
): Promise<never> {
  return await clientMatchDispatch(input);
}

export async function scoutPrematchDiscoveryWorkflow(
  input: ScoutPrematchDiscoveryInputEnvelope,
): Promise<ScoutPrematchDiscoveryResultEnvelope> {
  return await prematchDiscovery(input);
}

export async function scoutPrematchGameWorkflow(
  input: ScoutPrematchGameInputEnvelope,
): Promise<ScoutPrematchGameResultEnvelope> {
  return await prematchGame(input);
}

export async function scoutNotificationWorkflow(
  input: ScoutNotificationInputEnvelope,
): Promise<ScoutNotificationResultEnvelope> {
  return await notification(input);
}

export async function scoutLakeProjectionWorkflow(
  input: ScoutLakeProjectionInputEnvelope,
): Promise<ScoutLakeProjectionResultEnvelope> {
  return await lakeProjection(input);
}

export async function scoutRecoveryBatchWorkflow(
  input: ScoutRecoveryBatchInputEnvelope,
): Promise<ScoutRecoveryBatchResultEnvelope> {
  return await recoveryBatch(input);
}

export async function scoutPipelineReconciliationWorkflow(
  input: ScoutPipelineReconciliationInputEnvelope,
): Promise<ScoutPipelineReconciliationResultEnvelope> {
  return await pipelineReconciliation(input);
}

export async function scoutSilentPostmatchBackfillWorkflow(
  input: ScoutSilentPostmatchBackfillInputEnvelope,
): Promise<ScoutSilentPostmatchBackfillResultEnvelope> {
  return await silentPostmatchBackfill(input);
}
