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
import type {
  ScoutDetachedWorkInput,
  ScoutQueueClass,
  ScoutStage,
} from "./contracts.ts";
import type {
  ScoutPrematchGameRef,
  ScoutTrigger,
} from "./pipeline-contracts.ts";
import type { ScoutPipelineActivityName } from "./activities.ts";

export const SCOUT_WORKFLOW_NAMES = {
  initialHistory: "scoutInitialHistoryWorkflow",
  exploreHistory: "scoutExploreHistoryWorkflow",
  exploreTimeline: "scoutExploreTimelineWorkflow",
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
  postMatchDiscovery: "scoutPostMatchDiscoveryWorkflow",
  matchProcessing: "scoutMatchProcessingWorkflow",
  clientMatchDispatch: "scoutClientMatchDispatchWorkflow",
  prematchDiscovery: "scoutPrematchDiscoveryWorkflow",
  prematchGame: "scoutPrematchGameWorkflow",
  notification: "scoutNotificationWorkflow",
  lakeProjection: "scoutLakeProjectionWorkflow",
  recoveryBatch: "scoutRecoveryBatchWorkflow",
  pipelineReconciliation: "scoutPipelineReconciliationWorkflow",
  silentPostmatchBackfill: "scoutSilentPostmatchBackfillWorkflow",
} as const;

/**
 * The nine durable match-pipeline Workflow Types, as a closed set.
 *
 * The task queue NAMES are shared with every other Scout Workflow —
 * `scoutTaskQueues` — since an open execution recorded the queue it was
 * dispatched on.
 */
export const SCOUT_PIPELINE_WORKFLOW_NAMES = [
  SCOUT_WORKFLOW_NAMES.postMatchDiscovery,
  SCOUT_WORKFLOW_NAMES.matchProcessing,
  SCOUT_WORKFLOW_NAMES.clientMatchDispatch,
  SCOUT_WORKFLOW_NAMES.prematchDiscovery,
  SCOUT_WORKFLOW_NAMES.prematchGame,
  SCOUT_WORKFLOW_NAMES.notification,
  SCOUT_WORKFLOW_NAMES.lakeProjection,
  SCOUT_WORKFLOW_NAMES.recoveryBatch,
  SCOUT_WORKFLOW_NAMES.pipelineReconciliation,
] as const;
export type ScoutPipelineWorkflowName =
  (typeof SCOUT_PIPELINE_WORKFLOW_NAMES)[number];

// ───────────────────────────────────────────────────────────────────────────
// The generation rename, as history
// ───────────────────────────────────────────────────────────────────────────

/**
 * The Workflow type each pipeline Workflow was issued under before the rename.
 *
 * Nothing registers these names any more: the bundle exports only the renamed
 * Workflows, so an execution still running under one of these types could not
 * make progress, and the release that dropped them waited for none to be left.
 * They remain for two readers that outlive the rename. `ScoutWorkflowStart`
 * rows keep the type they were requested under (`scoutRenamedWorkflowType`).
 * And a history recorded before the `scout-generation-rename` patch named
 * these types for its children, so replaying one has to issue them again
 * (`workflows/generation-rename.ts`).
 *
 * The same holds for Activities (`scoutPreRenameActivityType`).
 */
export const SCOUT_PRE_RENAME_WORKFLOW_TYPES = {
  [SCOUT_WORKFLOW_NAMES.postMatchDiscovery]:
    "scoutPostMatchDiscoveryV2Workflow",
  [SCOUT_WORKFLOW_NAMES.matchProcessing]: "scoutMatchProcessingV2Workflow",
  [SCOUT_WORKFLOW_NAMES.clientMatchDispatch]:
    "scoutClientMatchDispatchV2Workflow",
  [SCOUT_WORKFLOW_NAMES.prematchDiscovery]: "scoutPrematchDiscoveryV2Workflow",
  [SCOUT_WORKFLOW_NAMES.prematchGame]: "scoutPrematchGameV2Workflow",
  [SCOUT_WORKFLOW_NAMES.notification]: "scoutNotificationV2Workflow",
  [SCOUT_WORKFLOW_NAMES.lakeProjection]: "scoutLakeProjectionV2Workflow",
  [SCOUT_WORKFLOW_NAMES.recoveryBatch]: "scoutRecoveryBatchV2Workflow",
  [SCOUT_WORKFLOW_NAMES.pipelineReconciliation]:
    "scoutPipelineReconciliationV2Workflow",
  [SCOUT_WORKFLOW_NAMES.silentPostmatchBackfill]:
    "scoutSilentPostmatchBackfillV2Workflow",
} as const satisfies Record<
  | ScoutPipelineWorkflowName
  | typeof SCOUT_WORKFLOW_NAMES.silentPostmatchBackfill,
  string
>;

export type ScoutRenamedWorkflowName =
  keyof typeof SCOUT_PRE_RENAME_WORKFLOW_TYPES;

const RENAMED_WORKFLOW_TYPE_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(SCOUT_PRE_RENAME_WORKFLOW_TYPES).map(
    ([renamed, preRename]) => [preRename, renamed],
  ),
);

/**
 * The name a recorded Workflow type is issued under now: the renamed type for
 * a pre-rename one, and the type itself for anything else.
 *
 * Durable rows keep the type they were written with, so anything that compares
 * a recorded type with one issued now compares them under this name. The rows
 * are history and are never rewritten, so this outlives the rename.
 */
export function scoutRenamedWorkflowType(workflowType: string): string {
  return RENAMED_WORKFLOW_TYPE_OF.get(workflowType) ?? workflowType;
}

/**
 * The two pipeline Activities whose names did not change: one never carried
 * the suffix, and one kept its name because open histories recorded it.
 */
const UNRENAMED_PIPELINE_ACTIVITIES: ReadonlySet<string> = new Set([
  "readLegacyMatchCompletionV2",
  "runPrematchMaintenance",
] satisfies ScoutPipelineActivityName[]);

/**
 * The name an Activity was registered under before the rename: the
 * `V2`-suffixed name for a renamed pipeline Activity, and the name itself for
 * anything else. A history recorded before the `scout-generation-rename` patch
 * scheduled pipeline Activities under this name, so replaying one issues it
 * again. No Activity worker registers it any more.
 */
export function scoutPreRenameActivityType(name: string): string {
  return Object.hasOwn(SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES, name) &&
    !UNRENAMED_PIPELINE_ACTIVITIES.has(name)
    ? `${name}V2`
    : name;
}

/**
 * How a V2 family reuses a Workflow ID when something re-drives it.
 *
 * `ALLOW_DUPLICATE_FAILED_ONLY` is right for work whose successful completion
 * means there is nothing left to do: a match that processed, a projection that
 * staged. Restarting one would re-run a phase the durable state already
 * attests to.
 *
 * `ALLOW_DUPLICATE` is for the two families whose durable ROW — not the
 * Workflow's own completion — decides whether work remains. A notification run
 * that completed by recording `unknown-delivery` SUCCEEDED at its job; the
 * operator resolution that releases the intent happens out of band, so the
 * fresh run that follows a successful execution must not be refused. A
 * recovery batch is the same shape: the batch row holds the cursor and the
 * counts, its `workflowId` column is the adoption key, and a run that was
 * terminated rather than failed still leaves the batch live and driverless.
 *
 * The table lives here, beside the ID builders, because it answers the same
 * question they do — what identity a start claims and on what terms — and
 * because it has TWO callers that must never disagree: the reconciliation
 * sweep's child starter and the operations API's operator starts. The sweep
 * runs inside the Workflow sandbox and operator starts run in the backend, so
 * neither module can import the other; a policy spelled at both call sites
 * would drift silently, and the drift surfaces only as a start a human asked
 * for and Temporal refused. The Workflow and Client SDKs spell these policies
 * with the same strings, so both callers consume this table unmapped.
 *
 * The re-drivable families are named because the sweep re-drives them, and
 * reconciliation is named because an operator starts it. Every other V2
 * Workflow has no reuse question to answer — nothing sweeps, repairs or asks
 * for it by hand — and inventing a policy for one here would put a decision
 * nobody made into a table two callers trust.
 *
 * Reconciliation runs `ALLOW_DUPLICATE`. It is the sweep, so nothing re-drives
 * it, and its trigger is part of its ID, so an operator sweep cannot collide
 * with the scheduled one. What remains is the operator asking for another
 * sweep after the last one closed, which is a beta acceptance requirement and
 * which the durable record now carries: `ScoutWorkflowStart` holds one row per
 * request, and acceptance ends the handoff, so a repeat request is a new row
 * rather than a refusal. A sweep still running is joined by the operator
 * path's `USE_EXISTING` conflict policy, never duplicated. This was
 * `REJECT_DUPLICATE` only while the table could hold one request per Workflow
 * id (SJ-205); that limitation is gone, and so is the one-shot behaviour.
 */
export type ScoutReusePolicy =
  "ALLOW_DUPLICATE" | "ALLOW_DUPLICATE_FAILED_ONLY";

export const SCOUT_REDRIVABLE_WORKFLOW_NAMES = [
  SCOUT_WORKFLOW_NAMES.matchProcessing,
  SCOUT_WORKFLOW_NAMES.notification,
  SCOUT_WORKFLOW_NAMES.lakeProjection,
  SCOUT_WORKFLOW_NAMES.recoveryBatch,
] as const;
export type ScoutRedrivableWorkflowName =
  (typeof SCOUT_REDRIVABLE_WORKFLOW_NAMES)[number];

/** Every V2 Workflow whose start terms this table decides. */
export type ScoutReusePolicyWorkflowName =
  | ScoutRedrivableWorkflowName
  | typeof SCOUT_WORKFLOW_NAMES.clientMatchDispatch
  | typeof SCOUT_WORKFLOW_NAMES.pipelineReconciliation;

export const SCOUT_REUSE_POLICIES = {
  [SCOUT_WORKFLOW_NAMES.matchProcessing]: "ALLOW_DUPLICATE_FAILED_ONLY",
  [SCOUT_WORKFLOW_NAMES.clientMatchDispatch]: "ALLOW_DUPLICATE_FAILED_ONLY",
  [SCOUT_WORKFLOW_NAMES.notification]: "ALLOW_DUPLICATE",
  [SCOUT_WORKFLOW_NAMES.lakeProjection]: "ALLOW_DUPLICATE_FAILED_ONLY",
  [SCOUT_WORKFLOW_NAMES.recoveryBatch]: "ALLOW_DUPLICATE",
  [SCOUT_WORKFLOW_NAMES.pipelineReconciliation]: "ALLOW_DUPLICATE",
} as const satisfies Record<ScoutReusePolicyWorkflowName, ScoutReusePolicy>;

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

export function scoutInitialHistoryWorkflowId(
  stage: ScoutStage,
  puuid: string,
): string {
  return `scout-${stage}-history-${puuid}`;
}

export function scoutExploreHistoryWorkflowId(
  stage: ScoutStage,
  puuid: string,
  acquisitionBucket: number,
): string {
  return `scout-${stage}-explore-history-${puuid}-${acquisitionBucket.toString()}`;
}

export function scoutExploreTimelineWorkflowId(
  stage: ScoutStage,
  matchIds: readonly string[],
  acquisitionBucket: number,
): string {
  const stableIds = matchIds.toSorted().join("-");
  return `scout-${stage}-explore-timeline-${stableIds}-${acquisitionBucket.toString()}`;
}

export function scoutDetachedWorkWorkflowId(
  stage: ScoutStage,
  kind: ScoutDetachedWorkInput["kind"],
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
 * Every pipeline Workflow ID is `scout-{stage}-{kind}-v2-{identity}` and is
 * derived only from values already in the Workflow input, so a restart, a
 * retry and a reconciliation sweep all compute the same ID and collapse onto
 * the same execution instead of racing duplicates.
 *
 * The `-v2-` marker is identity, not a generation label, and stays: dropping
 * it would make `scout-prod-match-NA1_1` collide with the closed execution the
 * retired v1 pipeline ran under that ID, which `ALLOW_DUPLICATE_FAILED_ONLY`
 * refuses to reuse, and would split one match across two IDs for every open
 * execution.
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
export function scoutPostMatchDiscoveryWorkflowId(
  stage: ScoutStage,
  trigger: ScoutTrigger,
): string {
  return `scout-${stage}-post-match-discovery-v2-${trigger}`;
}

/** The per-match core: one execution per match, forever. */
export function scoutMatchProcessingWorkflowId(
  stage: ScoutStage,
  riotMatchId: RiotMatchId,
): string {
  return `scout-${stage}-match-v2-${riotMatchId}`;
}

/** One serialized native-match dispatcher per environment. */
export function scoutClientMatchDispatchWorkflowId(stage: ScoutStage): string {
  return `scout-${stage}-client-match-dispatch-v2`;
}

/**
 * One execution per live GAME, not per (account, game).
 *
 * The same game surfaces through every tracked account playing in it, and
 * those are the same snapshot to archive. Keying on the game id deduplicates
 * them; `gameRef.puuid` stays out of the ID and records only which account
 * surfaced the game so the spectator fetch can be re-issued.
 */
export function scoutPrematchGameWorkflowId(
  stage: ScoutStage,
  gameRef: ScoutPrematchGameRef,
): string {
  return `scout-${stage}-prematch-game-v2-${gameRef.platform}_${gameRef.gameId}`;
}

export function scoutNotificationWorkflowId(
  stage: ScoutStage,
  intentKey: NotificationIntentKey,
): string {
  return `scout-${stage}-notification-v2-${intentKey}`;
}

export function scoutLakeProjectionWorkflowId(
  stage: ScoutStage,
  riotMatchId: RiotMatchId,
): string {
  return `scout-${stage}-lake-projection-v2-${riotMatchId}`;
}

export function scoutRecoveryBatchWorkflowId(
  stage: ScoutStage,
  recoveryBatchId: RecoveryBatchId,
): string {
  return `scout-${stage}-recovery-batch-v2-${recoveryBatchId}`;
}

/** One reconciliation run per trigger, for the same reason as discovery. */
export function scoutPipelineReconciliationWorkflowId(
  stage: ScoutStage,
  trigger: ScoutTrigger,
): string {
  return `scout-${stage}-pipeline-reconciliation-v2-${trigger}`;
}

/**
 * One operator-started silent post-match backfill per label.
 *
 * The label is the operator's name for the batch (a date, an incident), so a
 * repeated start of the same batch collapses onto the execution already
 * running it, and a rerun after it closed is a deliberate new label or a
 * reuse the Workflow is idempotent under.
 */
export function scoutSilentPostmatchBackfillWorkflowId(
  stage: ScoutStage,
  label: string,
): string {
  return `scout-${stage}-silent-postmatch-backfill-v2-${label}`;
}

/**
 * The Riot match id a live game will be assigned.
 *
 * The id is not unknown before MatchV5 publishes the game, only unassembled:
 * Riot composes it from exactly the platform and game id the spectator payload
 * already carries. That is what lets a prematch snapshot, its match payload
 * and its timeline share one receipt scope.
 */
export function scoutPrematchGameMatchId(
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
export const SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES = {
  discoverPostMatchIds: "realtime",
  discoverPrematchGames: "realtime",
  readMatchPipelineState: "realtime",
  readLegacyMatchCompletionV2: "realtime",
  readNotificationIntent: "realtime",
  readRecoveryBatch: "background",
  archiveMatchArtifacts: "realtime",
  commitMatchObservation: "realtime",
  settleMatchMarkets: "realtime",
  applyMatchProgression: "realtime",
  finalizeTournamentResult: "realtime",
  recordMatchReceipts: "realtime",
  recordClientMatchTerminal: "realtime",
  advanceMatchCursor: "realtime",
  mintPostmatchNotificationIntents: "realtime",
  planMatchFanOut: "realtime",
  archivePrematchSnapshot: "realtime",
  planPrematchFanOut: "realtime",
  openPrematchMarkets: "realtime",
  runPrematchMaintenance: "realtime",
  markNotificationReady: "realtime",
  renderNotificationArtifact: "background",
  beginNotificationSend: "realtime",
  deliverNotification: "realtime",
  recordNotificationOutcome: "realtime",
  afterNotificationDelivered: "realtime",
  stageLakeProjection: "lake",
  scanRecoveryPage: "background",
  processRecoveryPage: "background",
  digestRecoveryBatch: "background",
  closeRecoveryBatch: "background",
  scanPipelineReconciliationPage: "background",
  backfillSilentPostmatchArtifact: "background",
} as const satisfies Record<ScoutPipelineActivityName, ScoutQueueClass>;
