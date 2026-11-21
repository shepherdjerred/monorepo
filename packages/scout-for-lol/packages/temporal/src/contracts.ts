import { z } from "zod";

export const TemporalNamespaceSchema = z.enum(["dev", "beta", "prod"]);
export type TemporalNamespace = z.infer<typeof TemporalNamespaceSchema>;

export const ScoutStageSchema = TemporalNamespaceSchema;
export type ScoutStage = TemporalNamespace;

export const DETACHED_WORK_MAX_ATTEMPTS = 4;

const OpaqueIdentifierSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Z0-9][\w.:-]*$/i);

// Riot PUUIDs are base64url-derived and may legitimately start with `_` or
// `-` (e.g. "_UiFP1VZrFut5_6UFe-ks..."), unlike our own generated identifiers.
// Reusing OpaqueIdentifierSchema's leading-alnum assumption here throws on
// every replay of an affected workflow, wedging it forever.
const RiotPuuidSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[\w.:-]+$/);

const IsoInstantSchema = z.iso.datetime({ offset: true });

export const ScoutWorkflowStatusSchema = z.enum([
  "pending",
  "running",
  "stop-requested",
  "cancelled",
  "completed",
  "failed",
  "stale",
  "no-op",
]);
export type ScoutWorkflowStatus = z.infer<typeof ScoutWorkflowStatusSchema>;

export const ScoutInitialHistoryInputSchema = z.object({
  stage: ScoutStageSchema,
  puuid: RiotPuuidSchema,
  cursor: z.string().min(1).max(512).optional(),
  runOnStart: z.boolean().optional(),
  pagesProcessed: z.number().int().nonnegative().default(0),
  pagesInCurrentRun: z.number().int().nonnegative().default(0),
});
export type ScoutInitialHistoryInput = z.infer<
  typeof ScoutInitialHistoryInputSchema
>;

export const ScoutExploreHistoryInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  puuid: RiotPuuidSchema,
  region: z.enum([
    "BRAZIL",
    "EU_EAST",
    "EU_WEST",
    "KOREA",
    "LAT_NORTH",
    "LAT_SOUTH",
    "AMERICA_NORTH",
    "OCEANIA",
    "TURKEY",
    "RUSSIA",
    "JAPAN",
    "VIETNAM",
    "TAIWAN",
    "SINGAPORE",
    "PBE",
  ]),
  /** Ten-minute UTC bucket: coalesces simultaneous asks but permits refreshes. */
  acquisitionBucket: z.number().int().nonnegative(),
  requestedMatches: z.number().int().min(1).max(100).default(100),
  // Omitted on legacy ranked executions: do not add a default that changes
  // their recorded Activity arguments during Workflow replay.
  matchType: z.enum(["ranked", "normal"]).optional(),
});
export type ScoutExploreHistoryInput = z.infer<
  typeof ScoutExploreHistoryInputSchema
>;

export const ScoutExploreHistoryResultSchema = z.strictObject({
  requested: z.number().int().nonnegative(),
  found: z.number().int().nonnegative(),
  alreadyAvailable: z.number().int().nonnegative(),
  ingested: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type ScoutExploreHistoryResult = z.infer<
  typeof ScoutExploreHistoryResultSchema
>;

export const ScoutExploreTimelineInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  matchIds: z.array(OpaqueIdentifierSchema).min(1).max(10),
  /** Ten-minute UTC bucket coalesces simultaneous requests. */
  acquisitionBucket: z.number().int().nonnegative(),
});
export type ScoutExploreTimelineInput = z.infer<
  typeof ScoutExploreTimelineInputSchema
>;

export const ScoutExploreTimelineResultSchema = z.strictObject({
  requested: z.number().int().nonnegative(),
  alreadyAvailable: z.number().int().nonnegative(),
  ingested: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
});
export type ScoutExploreTimelineResult = z.infer<
  typeof ScoutExploreTimelineResultSchema
>;

export const ScoutIngestionReconciliationInputSchema = z.object({
  stage: ScoutStageSchema,
  trigger: z.enum(["schedule", "gateway-ready"]),
});
export type ScoutIngestionReconciliationInput = z.infer<
  typeof ScoutIngestionReconciliationInputSchema
>;

export const ScoutParticipantCrawlInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  trigger: z.literal("schedule"),
});
export type ScoutParticipantCrawlInput = z.infer<
  typeof ScoutParticipantCrawlInputSchema
>;

/** How one crawl tick ended; counts only, never identifiers. */
export const ScoutParticipantCrawlResultSchema = z.strictObject({
  status: z.enum([
    "disabled",
    "budget-exhausted",
    "completed",
    "rate-limited",
    "upstream-error",
  ]),
  seededObservations: z.number().int().nonnegative(),
  admittedPlayers: z.number().int().nonnegative(),
  playersVisited: z.number().int().nonnegative(),
  matchesStored: z.number().int().nonnegative(),
  segmentsWritten: z.number().int().nonnegative(),
});
export type ScoutParticipantCrawlResult = z.infer<
  typeof ScoutParticipantCrawlResultSchema
>;

/** Frozen capability inventory for unpatched retained queue-canary histories. */
export const SCOUT_BACKGROUND_JOB_KINDS_V1 = [
  "competition-refresh",
  "competition-scheduled-updates",
  "competition-validation",
  "bucks-reconciliation",
  "weekly-bucks-leaderboard",
  "player-pruning",
  "removed-guild-cleanup",
  "match-time-rebuild",
  "outreach",
  "conversion-check",
  "summoner-index-backfill",
  "custom-nights-expiry",
  "notification-intent-expiry",
  "prediction-ingest",
  "legacy-backfill",
  "progression-reconciliation",
  "mvp-tally-refresh",
  "support-inbox",
  "clash-snapshot",
] as const;

/** Current producers and queue capability probes advertise only these jobs. */
export const ScoutActiveBackgroundJobKindSchema = z.enum(
  SCOUT_BACKGROUND_JOB_KINDS_V1.filter(
    (kind) =>
      kind !== "custom-nights-expiry" &&
      kind !== "bucks-reconciliation" &&
      kind !== "weekly-bucks-leaderboard",
  ),
);
/** Retained Workflow inputs still decode; retired Activities complete without effects. */
export const ScoutBackgroundJobInputSchema = z.object({
  stage: ScoutStageSchema,
  kind: z.enum(
    SCOUT_BACKGROUND_JOB_KINDS_V1.filter(
      (kind) => kind !== "custom-nights-expiry",
    ),
  ),
});
export type ScoutBackgroundJobInput = z.infer<
  typeof ScoutBackgroundJobInputSchema
>;

export const ScoutDetachedWorkInputSchema = z.object({
  stage: ScoutStageSchema,
  // parlay-generation is retained solely to replay issued histories.
  kind: z.enum(["champion-mastery-refresh", "parlay-generation"]),
  workId: OpaqueIdentifierSchema,
});
export type ScoutDetachedWorkInput = z.infer<
  typeof ScoutDetachedWorkInputSchema
>;

export const ScoutReportLakeInputSchema = z.object({
  stage: ScoutStageSchema,
  kind: z.enum(["fold", "rebuild"]),
});
export type ScoutReportLakeInput = z.infer<typeof ScoutReportLakeInputSchema>;

export const ScoutReportRunInputSchema = z.object({
  stage: ScoutStageSchema,
  reportId: OpaqueIdentifierSchema,
  revision: z.number().int().nonnegative(),
  runId: OpaqueIdentifierSchema.optional(),
  source: z.enum(["schedule", "manual"]),
  post: z.boolean().default(false),
});
export type ScoutReportRunInput = z.infer<typeof ScoutReportRunInputSchema>;

export const ScoutReportActivityInputSchema = ScoutReportRunInputSchema.extend({
  workflowRunId: OpaqueIdentifierSchema,
});
export type ScoutReportActivityInput = z.infer<
  typeof ScoutReportActivityInputSchema
>;

export const ScoutReportScheduleReconcilerInputSchema = z.object({
  stage: ScoutStageSchema,
});
export type ScoutReportScheduleReconcilerInput = z.infer<
  typeof ScoutReportScheduleReconcilerInputSchema
>;

export const ScoutInteractiveRunInputSchema = z.object({
  stage: ScoutStageSchema,
  kind: z.enum(["explore", "report-ai"]),
  databaseRunId: OpaqueIdentifierSchema,
});
export type ScoutInteractiveRunInput = z.infer<
  typeof ScoutInteractiveRunInputSchema
>;

export const ScoutQueueClassSchema = z.enum([
  "gateway",
  "realtime",
  "interactive",
  "background",
  "lake",
]);
export type ScoutQueueClass = z.infer<typeof ScoutQueueClassSchema>;

/**
 * The Activity queue classes whose release-canary probe runs on a reserved
 * sibling queue rather than on the work queue itself
 * (`scoutProbeTaskQueues`).
 *
 * These queues run real work under deliberately small slot budgets — one slot
 * each for `background` and `lake` — so a probe dispatched onto them waits
 * behind whatever long Activity holds the slot, and a release gate that
 * waited there measured load instead of the candidate. `gateway` is excluded
 * because its queue runs nothing but the probe.
 */
export const ScoutReservedProbeQueueClassSchema = ScoutQueueClassSchema.exclude(
  ["gateway"],
);
export type ScoutReservedProbeQueueClass = z.infer<
  typeof ScoutReservedProbeQueueClassSchema
>;
export const SCOUT_RESERVED_PROBE_QUEUE_CLASSES =
  ScoutReservedProbeQueueClassSchema.options;

export const ScoutQueueCanaryInputSchema = z.object({
  stage: ScoutStageSchema,
  canaryId: OpaqueIdentifierSchema,
  backgroundJobKinds: z.array(z.string()).optional(),
  includeGateway: z.boolean().optional(),
});
export type ScoutQueueCanaryInput = z.infer<typeof ScoutQueueCanaryInputSchema>;

export const ScoutQueueCanaryProbeInputSchema =
  ScoutQueueCanaryInputSchema.extend({
    queueClass: ScoutQueueClassSchema,
  });
export type ScoutQueueCanaryProbeInput = z.infer<
  typeof ScoutQueueCanaryProbeInputSchema
>;

export const ScoutQueueCanaryProbeResultSchema =
  ScoutQueueCanaryProbeInputSchema.extend({
    /** The work queue the probe proves is polled. */
    taskQueue: z.string().min(1),
    /**
     * The reserved probe queue the probe executed on, when it ran beside its
     * work queue rather than on it (`scoutProbeTaskQueues`).
     */
    probeTaskQueue: z.string().min(1).optional(),
  });
export type ScoutQueueCanaryProbeResult = z.infer<
  typeof ScoutQueueCanaryProbeResultSchema
>;

export const ScoutHallBaselineInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  guildId: OpaqueIdentifierSchema,
  revision: z.number().int().positive(),
});
export type ScoutHallBaselineInput = z.infer<
  typeof ScoutHallBaselineInputSchema
>;

export const ScoutChallengeRunRecomputeInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  runId: z.uuid(),
  revision: z.number().int().positive(),
  cursor: z
    .strictObject({
      gameEndMs: z.number().int().nonnegative(),
      matchId: OpaqueIdentifierSchema,
      puuid: RiotPuuidSchema,
    })
    .optional(),
  pagesProcessed: z.number().int().nonnegative().default(0),
});
export type ScoutChallengeRunRecomputeInput = z.infer<
  typeof ScoutChallengeRunRecomputeInputSchema
>;

export const ScoutChallengeRunRecomputePageResultSchema = z.strictObject({
  complete: z.boolean(),
  nextCursor: ScoutChallengeRunRecomputeInputSchema.shape.cursor,
  evaluatedMatches: z.number().int().nonnegative(),
});
export type ScoutChallengeRunRecomputePageResult = z.infer<
  typeof ScoutChallengeRunRecomputePageResultSchema
>;

export const ScoutDuelSeriesInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  seriesId: z.uuid(),
  deadlineAt: IsoInstantSchema,
});
export type ScoutDuelSeriesInput = z.infer<typeof ScoutDuelSeriesInputSchema>;

export const ScoutDuelSeriesRefreshResultSchema = z.strictObject({
  terminal: z.boolean(),
  status: z.string().min(1),
  deadlineAt: IsoInstantSchema,
});
export type ScoutDuelSeriesRefreshResult = z.infer<
  typeof ScoutDuelSeriesRefreshResultSchema
>;

export const ScoutDuelSeriesChangeSchema = z.strictObject({
  requestId: OpaqueIdentifierSchema,
});
export type ScoutDuelSeriesChange = z.infer<typeof ScoutDuelSeriesChangeSchema>;

/** A Riot match ID such as `NA1_5123456789`. */
const RiotMatchIdSchema = z.string().regex(/^[A-Z0-9]{2,6}_\d{1,20}$/);

/**
 * The post-game review of one game one Scout user recorded. The identity is
 * the owner and the match, so a trigger that arrives twice, or from both the
 * recording and the match evidence, is the same Workflow.
 */
export const ScoutCoachReviewInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  ownerId: OpaqueIdentifierSchema,
  matchId: RiotMatchIdSchema,
});
export type ScoutCoachReviewInput = z.infer<typeof ScoutCoachReviewInputSchema>;

/** Why no review is produced, none of which a retry would change. */
export const ScoutCoachReviewSkipReasonSchema = z.enum([
  "coach_disabled",
  "no_explore_access",
  "no_recording",
  "evidence_unresolved",
  "not_a_participant",
]);
export type ScoutCoachReviewSkipReason = z.infer<
  typeof ScoutCoachReviewSkipReasonSchema
>;

export const ScoutCoachReviewStartResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({ outcome: z.literal("started"), runId: z.uuid() }),
    z.strictObject({
      outcome: z.literal("skipped"),
      reason: ScoutCoachReviewSkipReasonSchema,
    }),
    /** Explore's quota or spend limit refused the turn; recorded, not retried. */
    z.strictObject({ outcome: z.literal("declined") }),
    /** The review already reached a terminal state in an earlier execution. */
    z.strictObject({
      outcome: z.literal("settled"),
      status: z.enum(["ready", "declined", "failed"]),
    }),
  ],
);
export type ScoutCoachReviewStartResult = z.infer<
  typeof ScoutCoachReviewStartResultSchema
>;

export const ScoutCoachReviewSettleInputSchema =
  ScoutCoachReviewInputSchema.safeExtend({
    runId: z.uuid(),
    /** True once the Workflow has waited as long as it will. */
    giveUp: z.boolean(),
  });
export type ScoutCoachReviewSettleInput = z.infer<
  typeof ScoutCoachReviewSettleInputSchema
>;

export const ScoutCoachReviewResultSchema = z.strictObject({
  status: z.enum(["ready", "declined", "failed", "skipped"]),
  reason: ScoutCoachReviewSkipReasonSchema.optional(),
});
export type ScoutCoachReviewResult = z.infer<
  typeof ScoutCoachReviewResultSchema
>;

export const InitialHistoryPageResultSchema = z.object({
  nextCursor: z.string().min(1).max(512).optional(),
  nextAttemptAt: IsoInstantSchema.optional(),
  persistedMatches: z.number().int().nonnegative(),
  complete: z.boolean(),
  nextAction: z.enum(["continue", "fold-lake"]).default("continue"),
});
export type InitialHistoryPageResult = z.infer<
  typeof InitialHistoryPageResultSchema
>;

export const IngestionReconciliationResultSchema = z.object({
  customOperations: z.array(z.string().min(1)).optional(),
  customPublications: z
    .array(
      z.strictObject({ nightId: z.uuid(), revision: z.int().nonnegative() }),
    )
    .optional(),
  initialHistoryPuuids: z.array(RiotPuuidSchema),
  detachedWorks: z.array(
    ScoutDetachedWorkInputSchema.pick({ kind: true, workId: true }),
  ),
  interactiveRuns: z.array(
    ScoutInteractiveRunInputSchema.pick({
      kind: true,
      databaseRunId: true,
    }),
  ),
});
export type IngestionReconciliationResult = z.infer<
  typeof IngestionReconciliationResultSchema
>;

export const ScoutPostMatchMaintenanceInputSchema = z.object({
  stage: ScoutStageSchema,
  settleDareV2Deadlines: z.boolean(),
  evidenceWatermark: z.iso.datetime().optional(),
  /**
   * Which poll this maintenance may close, by the instant it was claimed at.
   *
   * Post-match discovery claims its poll durably for the whole Workflow, and
   * the close is guarded on this identity, so a run whose claim was taken
   * over fails loudly instead of marking a later run's poll complete.
   */
  pollOwner: z.iso.datetime(),
});
export type ScoutPostMatchMaintenanceInput = z.infer<
  typeof ScoutPostMatchMaintenanceInputSchema
>;

export const ReportScheduleDrainResultSchema = z.object({
  processed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type ReportScheduleDrainResult = z.infer<
  typeof ReportScheduleDrainResultSchema
>;

export const InteractiveOutcomeSchema = z.object({
  status: z.enum(["completed", "cancelled", "interrupted", "failed"]),
  partialOutputAvailable: z.boolean(),
});
export type InteractiveOutcome = z.infer<typeof InteractiveOutcomeSchema>;

export const ScoutScheduleOwnershipMemoSchema = z.strictObject({
  owner: z.literal("scout-for-lol"),
  stage: ScoutStageSchema,
  reportId: OpaqueIdentifierSchema,
  schemaVersion: z.literal(1),
});
