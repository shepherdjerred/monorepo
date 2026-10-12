import type {
  InitialHistoryPageResult,
  IngestionReconciliationResult,
  InteractiveOutcome,
  ReportScheduleDrainResult,
  ScoutBackgroundJobInput,
  ScoutDetachedWorkInput,
  ScoutIngestionReconciliationInput,
  ScoutInitialHistoryInput,
  ScoutExploreHistoryInput,
  ScoutExploreHistoryResult,
  ScoutExploreTimelineInput,
  ScoutExploreTimelineResult,
  ScoutInteractiveRunInput,
  ScoutPostMatchMaintenanceInput,
  ScoutQueueCanaryProbeInput,
  ScoutQueueCanaryProbeResult,
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
  ScoutGameRef,
  ScoutDurableCommit,
  ScoutIntentAttemptRef,
  ScoutIntentRef,
  ScoutMatchRef,
  ScoutRecoveryBatchRef,
} from "./pipeline-contracts.ts";
import type {
  ScoutPipelineReconciliationInput,
  ScoutPostMatchDiscoveryInput,
  ScoutPrematchDiscoveryInput,
} from "./workflow-contracts.ts";
import type {
  ScoutArchiveResult,
  ScoutFanOutResult,
  ScoutGuardedEffectResult,
  ScoutLakeStagingResult,
  ScoutLegacyMatchCompletionV2Result,
  ScoutMatchCursorResult,
  ScoutMintedIntentsResult,
  ScoutMatchObservationInput,
  ScoutMatchObservationResult,
  ScoutMatchPipelineStateResult,
  ScoutMatchReceiptsInput,
  ScoutNotificationDeliveryResult,
  ScoutNotificationFollowUpResult,
  ScoutNotificationIntentResult,
  ScoutNotificationOutcomeInput,
  ScoutNotificationRenderResult,
  ScoutNotificationTransitionResult,
  ScoutPostMatchScanResult,
  ScoutPrematchArchiveResult,
  ScoutPrematchScanResult,
  ScoutReceiptsResult,
  ScoutReconciliationScanResult,
  ScoutRecoveryBatchStateResult,
  ScoutRecoveryCloseInput,
  ScoutRecoveryProcessResult,
  ScoutRecoveryScanResult,
  ScoutRecoveryTransitionResult,
  ScoutTournamentResultResult,
} from "./activity-contracts.ts";
import type { ScoutSilentPostmatchBackfillResult } from "./silent-postmatch-backfill.ts";

export type ScoutTemporalActivities = {
  probeQueue: (
    input: ScoutQueueCanaryProbeInput,
  ) => Promise<ScoutQueueCanaryProbeResult>;
  runPostMatchMaintenance: (
    input: ScoutPostMatchMaintenanceInput,
  ) => Promise<void>;
  fetchInitialHistoryPage: (
    input: ScoutInitialHistoryInput,
  ) => Promise<InitialHistoryPageResult>;
  importExploreHistory: (
    input: ScoutExploreHistoryInput,
  ) => Promise<ScoutExploreHistoryResult>;
  importExploreTimelines: (
    input: ScoutExploreTimelineInput,
  ) => Promise<ScoutExploreTimelineResult>;
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
 * Activities the nine V2 Workflow Types call.
 *
 * Every signature is identifier-in, summary-out: an input carries references
 * the backend can resolve, and a result carries domain state unions,
 * repository outcomes and counts. No Riot payload, rendered report, image or
 * settlement body crosses this boundary; artifact DESCRIPTORS do, because they
 * name stored bytes rather than carrying them.
 *
 * The queue each Activity runs on is declared once, in
 * `SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES` (`identifiers.ts`); the Workflows proxy
 * them through the matching factory in `workflows/activity-options.ts`.
 */
export type ScoutPipelineActivities = {
  // Discovery — Riot reads, realtime.
  discoverPostMatchIds: (
    input: ScoutPostMatchDiscoveryInput,
  ) => Promise<ScoutPostMatchScanResult>;
  discoverPrematchGames: (
    input: ScoutPrematchDiscoveryInput,
  ) => Promise<ScoutPrematchScanResult>;

  // Resume points — one aggregate read per machine, realtime except recovery.
  readMatchPipelineState: (
    input: ScoutMatchRef,
  ) => Promise<ScoutMatchPipelineStateResult>;
  readLegacyMatchCompletionV2: (
    input: ScoutMatchRef,
  ) => Promise<ScoutLegacyMatchCompletionV2Result>;
  readNotificationIntent: (
    input: ScoutIntentRef,
  ) => Promise<ScoutNotificationIntentResult>;
  readRecoveryBatch: (
    input: ScoutRecoveryBatchRef,
  ) => Promise<ScoutRecoveryBatchStateResult>;

  // Per-match core — Riot fetch, S3 write and short domain commits, realtime.
  archiveMatchArtifacts: (input: ScoutMatchRef) => Promise<ScoutArchiveResult>;
  commitMatchObservation: (
    input: ScoutMatchObservationInput,
  ) => Promise<ScoutMatchObservationResult>;
  settleMatchMarkets: (
    input: ScoutMatchRef,
  ) => Promise<ScoutGuardedEffectResult>;
  applyMatchProgression: (
    input: ScoutMatchRef,
  ) => Promise<ScoutGuardedEffectResult>;
  finalizeTournamentResult: (
    input: ScoutMatchRef,
  ) => Promise<ScoutTournamentResultResult>;
  recordMatchReceipts: (
    input: ScoutMatchReceiptsInput,
  ) => Promise<ScoutReceiptsResult>;
  recordClientMatchTerminal: (
    input: ScoutMatchRef,
  ) => Promise<ScoutDurableCommit>;
  advanceMatchCursor: (input: ScoutMatchRef) => Promise<ScoutMatchCursorResult>;
  mintPostmatchNotificationIntents: (
    input: ScoutMatchRef,
  ) => Promise<ScoutMintedIntentsResult>;
  planMatchFanOut: (input: ScoutMatchRef) => Promise<ScoutFanOutResult>;

  // Prematch — spectator fetch and S3 write, realtime.
  archivePrematchSnapshot: (
    input: ScoutGameRef,
  ) => Promise<ScoutPrematchArchiveResult>;
  planPrematchFanOut: (input: ScoutMatchRef) => Promise<ScoutFanOutResult>;
  openPrematchMarkets: (
    input: ScoutMatchRef,
  ) => Promise<ScoutGuardedEffectResult>;
  /**
   * The prematch maintenance sweeps, once per discovery poll. They are
   * environment-wide, so the poll's own input (the stage) is the whole input.
   */
  runPrematchMaintenance: (input: ScoutPrematchDiscoveryInput) => Promise<void>;

  // Notification — rendering on background, the intent machine on realtime.
  markNotificationReady: (
    input: ScoutIntentRef,
  ) => Promise<ScoutNotificationTransitionResult>;
  renderNotificationArtifact: (
    input: ScoutIntentRef,
  ) => Promise<ScoutNotificationRenderResult>;
  beginNotificationSend: (
    input: ScoutIntentAttemptRef,
  ) => Promise<ScoutNotificationTransitionResult>;
  deliverNotification: (
    input: ScoutIntentAttemptRef,
  ) => Promise<ScoutNotificationDeliveryResult>;
  recordNotificationOutcome: (
    input: ScoutNotificationOutcomeInput,
  ) => Promise<ScoutNotificationTransitionResult>;
  afterNotificationDelivered: (
    input: ScoutIntentAttemptRef,
  ) => Promise<ScoutNotificationFollowUpResult>;

  // Lake — receipted staging on the lake queue, heartbeating.
  stageLakeProjection: (
    input: ScoutMatchRef,
  ) => Promise<ScoutLakeStagingResult>;

  // Recovery and reconciliation — bounded scans, background.
  scanRecoveryPage: (
    input: ScoutRecoveryBatchRef,
  ) => Promise<ScoutRecoveryScanResult>;
  processRecoveryPage: (
    input: ScoutRecoveryBatchRef,
  ) => Promise<ScoutRecoveryProcessResult>;
  digestRecoveryBatch: (
    input: ScoutRecoveryBatchRef,
  ) => Promise<ScoutRecoveryTransitionResult>;
  closeRecoveryBatch: (
    input: ScoutRecoveryCloseInput,
  ) => Promise<ScoutRecoveryTransitionResult>;
  scanPipelineReconciliationPage: (
    input: ScoutPipelineReconciliationInput,
  ) => Promise<ScoutReconciliationScanResult>;

  // Operator backfill — render and attest one match's post-match report with
  // no intent and no delivery, background. See `silent-postmatch-backfill.ts`.
  backfillSilentPostmatchArtifact: (
    input: ScoutMatchRef,
  ) => Promise<ScoutSilentPostmatchBackfillResult>;
};

export type ScoutPipelineActivityName = keyof ScoutPipelineActivities;
