import type {
  InitialHistoryPageResult,
  IngestionReconciliationResult,
  InteractiveOutcome,
  PostMatchDiscoveryResult,
  ReportScheduleDrainResult,
  ScoutBackgroundJobInput,
  ScoutDetachedWorkInput,
  ScoutIngestionReconciliationInput,
  ScoutInitialHistoryInput,
  ScoutInteractiveRunInput,
  ScoutMatchIngestionInput,
  ScoutPostMatchDiscoveryInput,
  ScoutPostMatchMaintenanceInput,
  ScoutQueueCanaryProbeInput,
  ScoutQueueCanaryProbeResult,
  ScoutRealtimePollInput,
  ScoutReportLakeInput,
  ScoutReportActivityInput,
  ScoutReportScheduleReconcilerInput,
  ScoutHallBaselineInput,
  ScoutChallengeRunRecomputeInput,
  ScoutChallengeRunRecomputePageResult,
  ScoutDuelSeriesInput,
  ScoutDuelSeriesRefreshResult,
} from "./contracts.ts";
import type {
  ScoutGameRefV2,
  ScoutIntentAttemptRefV2,
  ScoutIntentRefV2,
  ScoutMatchRefV2,
  ScoutRecoveryBatchRefV2,
} from "./contracts-v2.ts";
import type {
  ScoutPipelineReconciliationV2Input,
  ScoutPostMatchDiscoveryV2Input,
  ScoutPrematchDiscoveryV2Input,
} from "./workflow-contracts-v2.ts";
import type {
  ScoutArchiveV2Result,
  ScoutFanOutV2Result,
  ScoutGuardedEffectV2Result,
  ScoutLakeStagingV2Result,
  ScoutMatchCursorV2Result,
  ScoutMatchObservationV2Result,
  ScoutMatchPipelineStateV2Result,
  ScoutMatchReceiptsV2Input,
  ScoutNotificationDeliveryV2Result,
  ScoutNotificationIntentV2Result,
  ScoutNotificationOutcomeV2Input,
  ScoutNotificationRenderV2Result,
  ScoutNotificationTransitionV2Result,
  ScoutPostMatchScanV2Result,
  ScoutPrematchArchiveV2Result,
  ScoutPrematchScanV2Result,
  ScoutReceiptsV2Result,
  ScoutReconciliationScanV2Result,
  ScoutRecoveryBatchStateV2Result,
  ScoutRecoveryCloseV2Input,
  ScoutRecoveryProcessV2Result,
  ScoutRecoveryScanV2Result,
  ScoutRecoveryTransitionV2Result,
} from "./activity-contracts-v2.ts";

export type ScoutTemporalActivities = {
  probeQueue: (
    input: ScoutQueueCanaryProbeInput,
  ) => Promise<ScoutQueueCanaryProbeResult>;
  pollRealtime: (input: ScoutRealtimePollInput) => Promise<void>;
  discoverPostMatchIds: (
    input: ScoutPostMatchDiscoveryInput,
  ) => Promise<PostMatchDiscoveryResult>;
  runPostMatchMaintenance: (
    input: ScoutPostMatchMaintenanceInput,
  ) => Promise<void>;
  ingestMatch: (input: ScoutMatchIngestionInput) => Promise<void>;
  fetchInitialHistoryPage: (
    input: ScoutInitialHistoryInput,
  ) => Promise<InitialHistoryPageResult>;
  reconcileIngestion: (
    input: ScoutIngestionReconciliationInput,
  ) => Promise<IngestionReconciliationResult>;
  runBackgroundJob: (input: ScoutBackgroundJobInput) => Promise<void>;
  runDetachedBackgroundWork: (input: ScoutDetachedWorkInput) => Promise<void>;
  runDetachedLakeWork: (input: ScoutDetachedWorkInput) => Promise<void>;
  runReportLakeJob: (input: ScoutReportLakeInput) => Promise<void>;
  drainReportScheduleOutbox: (
    input: ScoutReportScheduleReconcilerInput,
  ) => Promise<ReportScheduleDrainResult>;
  runReport: (input: ScoutReportActivityInput) => Promise<void>;
  runInteractive: (
    input: ScoutInteractiveRunInput,
  ) => Promise<InteractiveOutcome>;
  persistInteractiveOutcome: (
    input: ScoutInteractiveRunInput & { outcome: InteractiveOutcome },
  ) => Promise<InteractiveOutcome>;
  runHallBaseline: (input: ScoutHallBaselineInput) => Promise<void>;
  recomputeChallengeRunPage: (
    input: ScoutChallengeRunRecomputeInput,
  ) => Promise<ScoutChallengeRunRecomputePageResult>;
  markChallengeRunRecomputeFailure: (
    input: ScoutChallengeRunRecomputeInput,
  ) => Promise<void>;
  refreshDuelSeries: (
    input: ScoutDuelSeriesInput,
  ) => Promise<ScoutDuelSeriesRefreshResult>;
  markDuelSeriesOverdue: (input: ScoutDuelSeriesInput) => Promise<void>;
};

/**
 * Activities the eight V2 Workflow Types call.
 *
 * Every signature is identifier-in, summary-out: an input carries references
 * the backend can resolve, and a result carries domain state unions,
 * repository outcomes and counts. No Riot payload, rendered report, image or
 * settlement body crosses this boundary; artifact DESCRIPTORS do, because they
 * name stored bytes rather than carrying them.
 *
 * The queue each Activity runs on is declared once, in
 * `SCOUT_V2_ACTIVITY_QUEUE_CLASSES` (`identifiers.ts`); the Workflows proxy
 * them through the matching factory in `workflows/activity-options.ts`.
 */
export type ScoutTemporalV2Activities = {
  // Discovery — Riot reads, realtime.
  discoverPostMatchIdsV2: (
    input: ScoutPostMatchDiscoveryV2Input,
  ) => Promise<ScoutPostMatchScanV2Result>;
  discoverPrematchGamesV2: (
    input: ScoutPrematchDiscoveryV2Input,
  ) => Promise<ScoutPrematchScanV2Result>;

  // Resume points — one aggregate read per machine, realtime except recovery.
  readMatchPipelineStateV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutMatchPipelineStateV2Result>;
  readNotificationIntentV2: (
    input: ScoutIntentRefV2,
  ) => Promise<ScoutNotificationIntentV2Result>;
  readRecoveryBatchV2: (
    input: ScoutRecoveryBatchRefV2,
  ) => Promise<ScoutRecoveryBatchStateV2Result>;

  // Per-match core — Riot fetch, S3 write and short domain commits, realtime.
  archiveMatchArtifactsV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutArchiveV2Result>;
  commitMatchObservationV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutMatchObservationV2Result>;
  settleMatchMarketsV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutGuardedEffectV2Result>;
  applyMatchProgressionV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutGuardedEffectV2Result>;
  recordMatchReceiptsV2: (
    input: ScoutMatchReceiptsV2Input,
  ) => Promise<ScoutReceiptsV2Result>;
  advanceMatchCursorV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutMatchCursorV2Result>;
  planMatchFanOutV2: (input: ScoutMatchRefV2) => Promise<ScoutFanOutV2Result>;

  // Prematch — spectator fetch and S3 write, realtime.
  archivePrematchSnapshotV2: (
    input: ScoutGameRefV2,
  ) => Promise<ScoutPrematchArchiveV2Result>;
  planPrematchFanOutV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutFanOutV2Result>;

  // Notification — rendering on background, the intent machine on realtime.
  markNotificationReadyV2: (
    input: ScoutIntentRefV2,
  ) => Promise<ScoutNotificationTransitionV2Result>;
  renderNotificationArtifactV2: (
    input: ScoutIntentRefV2,
  ) => Promise<ScoutNotificationRenderV2Result>;
  beginNotificationSendV2: (
    input: ScoutIntentAttemptRefV2,
  ) => Promise<ScoutNotificationTransitionV2Result>;
  deliverNotificationV2: (
    input: ScoutIntentAttemptRefV2,
  ) => Promise<ScoutNotificationDeliveryV2Result>;
  recordNotificationOutcomeV2: (
    input: ScoutNotificationOutcomeV2Input,
  ) => Promise<ScoutNotificationTransitionV2Result>;

  // Lake — receipted staging on the lake queue, heartbeating.
  stageLakeProjectionV2: (
    input: ScoutMatchRefV2,
  ) => Promise<ScoutLakeStagingV2Result>;

  // Recovery and reconciliation — bounded scans, background.
  scanRecoveryPageV2: (
    input: ScoutRecoveryBatchRefV2,
  ) => Promise<ScoutRecoveryScanV2Result>;
  processRecoveryPageV2: (
    input: ScoutRecoveryBatchRefV2,
  ) => Promise<ScoutRecoveryProcessV2Result>;
  digestRecoveryBatchV2: (
    input: ScoutRecoveryBatchRefV2,
  ) => Promise<ScoutRecoveryTransitionV2Result>;
  closeRecoveryBatchV2: (
    input: ScoutRecoveryCloseV2Input,
  ) => Promise<ScoutRecoveryTransitionV2Result>;
  scanPipelineReconciliationPageV2: (
    input: ScoutPipelineReconciliationV2Input,
  ) => Promise<ScoutReconciliationScanV2Result>;
};

export type ScoutV2ActivityName = keyof ScoutTemporalV2Activities;
