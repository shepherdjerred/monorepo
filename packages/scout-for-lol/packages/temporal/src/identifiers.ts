import {
  RiotMatchIdSchema,
  type NotificationIntentKey,
  type RecoveryBatchId,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  type NotificationAttemptNonce,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { ScoutQueueClass, ScoutStage } from "./contracts.ts";
import type { ScoutPrematchGameRef, ScoutV2Trigger } from "./contracts-v2.ts";
import type { ScoutV2ActivityName } from "./activities.ts";

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
  hallBaseline: "scoutHallBaselineWorkflow",
  challengeRunRecompute: "scoutChallengeRunRecomputeWorkflow",
  duelSeries: "scoutDuelSeriesWorkflow",
  postMatchDiscoveryV2: "scoutPostMatchDiscoveryV2Workflow",
  matchProcessingV2: "scoutMatchProcessingV2Workflow",
  prematchDiscoveryV2: "scoutPrematchDiscoveryV2Workflow",
  prematchGameV2: "scoutPrematchGameV2Workflow",
  notificationV2: "scoutNotificationV2Workflow",
  lakeProjectionV2: "scoutLakeProjectionV2Workflow",
  recoveryBatchV2: "scoutRecoveryBatchV2Workflow",
  pipelineReconciliationV2: "scoutPipelineReconciliationV2Workflow",
} as const;

/**
 * The eight V2 Workflow Types, as a closed set.
 *
 * They are NEW types: the v1 entries above keep their names and their inputs
 * because open v1 executions recorded them. The task queue NAMES are likewise
 * unchanged — `scoutTaskQueues` is shared — since an open execution recorded
 * the queue it was dispatched on.
 */
export const SCOUT_V2_WORKFLOW_NAMES = [
  SCOUT_WORKFLOW_NAMES.postMatchDiscoveryV2,
  SCOUT_WORKFLOW_NAMES.matchProcessingV2,
  SCOUT_WORKFLOW_NAMES.prematchDiscoveryV2,
  SCOUT_WORKFLOW_NAMES.prematchGameV2,
  SCOUT_WORKFLOW_NAMES.notificationV2,
  SCOUT_WORKFLOW_NAMES.lakeProjectionV2,
  SCOUT_WORKFLOW_NAMES.recoveryBatchV2,
  SCOUT_WORKFLOW_NAMES.pipelineReconciliationV2,
] as const;
export type ScoutV2WorkflowName = (typeof SCOUT_V2_WORKFLOW_NAMES)[number];

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

export function scoutIngestionReconciliationGatewayReadyWorkflowId(
  stage: ScoutStage,
): string {
  return `scout-${stage}-ingestion-reconciliation-gateway-ready`;
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

export function scoutHallBaselineWorkflowId(
  stage: ScoutStage,
  guildId: string,
  revision: number,
): string {
  return `scout-${stage}-hall-${guildId}-${revision.toString()}`;
}

export function scoutChallengeRunRecomputeWorkflowId(
  stage: ScoutStage,
  runId: string,
  revision: number,
): string {
  return `scout-${stage}-challenge-${runId}-${revision.toString()}`;
}

export function scoutDuelSeriesWorkflowId(
  stage: ScoutStage,
  seriesId: string,
): string {
  return `scout-${stage}-duel-series-${seriesId}`;
}

export function scoutSchedulePrefix(stage: ScoutStage): string {
  return `scout-${stage}-report-`;
}

// ───────────────────────────────────────────────────────────────────────────
// V2 durable pipeline identifiers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every V2 Workflow ID is `scout-{stage}-{kind}-v2-{identity}` and is derived
 * only from values already in the Workflow input, so a restart, a retry and a
 * reconciliation sweep all compute the same ID and collapse onto the same
 * execution instead of racing duplicates.
 *
 * The `-v2-` marker keeps a V2 execution from colliding with its v1 sibling
 * while both pipelines run: `scout-prod-match-NA1_1` (v1) and
 * `scout-prod-match-v2-NA1_1` (V2) are the same match under two owners.
 *
 * Each interpolated identity must match `[A-Za-z0-9_.:-]+`, which is what
 * `scripts/replay-*-histories.ts` selects candidate histories with. The
 * contract schemas enforce that (`ScoutNotificationIntentKeySchema`,
 * `ScoutRecoveryBatchIdSchema`); these builders only interpolate, because a
 * builder that threw would throw inside a Workflow task and wedge the
 * execution on every retry.
 */

/**
 * One discovery run per trigger. Two triggers never collapse into one
 * execution, so an operator sweep cannot be silently absorbed by the
 * scheduled run that happened to already be in flight.
 */
export function scoutPostMatchDiscoveryV2WorkflowId(
  stage: ScoutStage,
  trigger: ScoutV2Trigger,
): string {
  return `scout-${stage}-post-match-discovery-v2-${trigger}`;
}

/** The per-match core: one execution per match, forever. */
export function scoutMatchProcessingV2WorkflowId(
  stage: ScoutStage,
  riotMatchId: RiotMatchId,
): string {
  return `scout-${stage}-match-v2-${riotMatchId}`;
}

/** One prematch poller per stage; the poll itself carries no identity. */
export function scoutPrematchDiscoveryV2WorkflowId(stage: ScoutStage): string {
  return `scout-${stage}-prematch-discovery-v2`;
}

/**
 * One execution per live GAME, not per (account, game).
 *
 * The same game surfaces through every tracked account playing in it, and
 * those are the same snapshot to archive. Keying on the game id deduplicates
 * them; `gameRef.puuid` stays out of the ID and records only which account
 * surfaced the game so the spectator fetch can be re-issued.
 */
export function scoutPrematchGameV2WorkflowId(
  stage: ScoutStage,
  gameRef: ScoutPrematchGameRef,
): string {
  return `scout-${stage}-prematch-game-v2-${gameRef.platform}_${gameRef.gameId}`;
}

export function scoutNotificationV2WorkflowId(
  stage: ScoutStage,
  intentKey: NotificationIntentKey,
): string {
  return `scout-${stage}-notification-v2-${intentKey}`;
}

export function scoutLakeProjectionV2WorkflowId(
  stage: ScoutStage,
  riotMatchId: RiotMatchId,
): string {
  return `scout-${stage}-lake-projection-v2-${riotMatchId}`;
}

export function scoutRecoveryBatchV2WorkflowId(
  stage: ScoutStage,
  recoveryBatchId: RecoveryBatchId,
): string {
  return `scout-${stage}-recovery-batch-v2-${recoveryBatchId}`;
}

/** One reconciliation run per trigger, for the same reason as discovery. */
export function scoutPipelineReconciliationV2WorkflowId(
  stage: ScoutStage,
  trigger: ScoutV2Trigger,
): string {
  return `scout-${stage}-pipeline-reconciliation-v2-${trigger}`;
}

/**
 * The Riot match id a live game will be assigned.
 *
 * The id is not unknown before MatchV5 publishes the game, only unassembled:
 * Riot composes it from exactly the platform and game id the spectator payload
 * already carries. That is what lets a prematch snapshot, its match payload
 * and its timeline share one receipt scope.
 */
export function scoutPrematchGameV2MatchId(
  gameRef: ScoutPrematchGameRef,
): RiotMatchId {
  return RiotMatchIdSchema.parse(`${gameRef.platform}_${gameRef.gameId}`);
}

/**
 * Name one send attempt of one notification intent.
 *
 * Derived from the Workflow run and the attempt number so it is deterministic
 * under replay, and distinct across runs so a crashed worker's attempt and the
 * attempt that replaces it can never be confused — which is what makes an
 * unobserved send resolvable against the exact attempt that produced it.
 */
export function scoutNotificationAttemptNonce(
  workflowRunId: string,
  attempt: number,
): NotificationAttemptNonce {
  return NotificationAttemptNonceSchema.parse(
    `${workflowRunId}:${attempt.toString()}`,
  );
}

/**
 * Where each V2 Activity runs. Declared once so a Workflow, the Activity
 * Worker registration, and the queue canary all read the same assignment
 * instead of three implicit agreements; `satisfies` makes an Activity added
 * without a queue a type error.
 *
 * Riot reads, S3 writes, short transactional domain commits and Discord
 * delivery go to `realtime`, where latency is the product. Rendering, AI, and
 * the bounded recovery and reconciliation scans go to `background`, where a
 * slow run must never sit in front of a live match. Lake staging goes to
 * `lake`, which owns the report lake's volume and heartbeats through long
 * projections. Nothing goes to `interactive`: that queue serves a human
 * waiting on an Explore or report-AI turn, and durable pipeline work must
 * never queue ahead of one.
 *
 * This lives here rather than beside the proxy factories in
 * `workflows/activity-options.ts` because the Activity Worker needs it too,
 * and that module imports `@temporalio/workflow`.
 */
export const SCOUT_V2_ACTIVITY_QUEUE_CLASSES = {
  discoverPostMatchIdsV2: "realtime",
  discoverPrematchGamesV2: "realtime",
  readMatchPipelineStateV2: "realtime",
  readNotificationIntentV2: "realtime",
  readRecoveryBatchV2: "background",
  archiveMatchArtifactsV2: "realtime",
  commitMatchObservationV2: "realtime",
  settleMatchMarketsV2: "realtime",
  applyMatchProgressionV2: "realtime",
  recordMatchReceiptsV2: "realtime",
  advanceMatchCursorV2: "realtime",
  planMatchFanOutV2: "realtime",
  archivePrematchSnapshotV2: "realtime",
  planPrematchFanOutV2: "realtime",
  markNotificationReadyV2: "realtime",
  renderNotificationArtifactV2: "background",
  beginNotificationSendV2: "realtime",
  deliverNotificationV2: "realtime",
  recordNotificationOutcomeV2: "realtime",
  stageLakeProjectionV2: "lake",
  scanRecoveryPageV2: "background",
  processRecoveryPageV2: "background",
  digestRecoveryBatchV2: "background",
  closeRecoveryBatchV2: "background",
  scanPipelineReconciliationPageV2: "background",
} as const satisfies Record<ScoutV2ActivityName, ScoutQueueClass>;
