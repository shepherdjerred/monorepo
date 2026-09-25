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

export const ScoutRealtimePollInputSchema = z.object({
  stage: ScoutStageSchema,
  // Keep the retired tournament discriminator while executions created by the
  // former Schedule can still replay or retry their recorded Activity.
  kind: z.enum(["prematch", "tournament-lobbies"]),
  scheduledStartAt: IsoInstantSchema.optional(),
  maximumAgeSeconds: z.number().int().positive(),
});
export type ScoutRealtimePollInput = z.infer<
  typeof ScoutRealtimePollInputSchema
>;

export const ScoutMatchIngestionInputSchema = z.object({
  stage: ScoutStageSchema,
  matchId: OpaqueIdentifierSchema,
  sourcePuuid: RiotPuuidSchema,
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
  delivery: z.enum(["live", "silent-backfill"]),
});
export type ScoutMatchIngestionInput = z.infer<
  typeof ScoutMatchIngestionInputSchema
>;

export const ScoutPostMatchDiscoveryInputSchema = z.object({
  stage: ScoutStageSchema,
  scheduledStartAt: IsoInstantSchema.optional(),
});
export type ScoutPostMatchDiscoveryInput = z.infer<
  typeof ScoutPostMatchDiscoveryInputSchema
>;

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

export const ScoutBackgroundJobInputSchema = z.object({
  stage: ScoutStageSchema,
  kind: z.enum([
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
    "prediction-ingest",
    "legacy-backfill",
    "progression-outbox",
    "clash-snapshot",
  ]),
});
export type ScoutBackgroundJobInput = z.infer<
  typeof ScoutBackgroundJobInputSchema
>;

export const ScoutDetachedWorkInputSchema = z.object({
  stage: ScoutStageSchema,
  kind: z.enum(["parlay-generation", "champion-mastery-refresh"]),
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
  "realtime",
  "interactive",
  "background",
  "lake",
]);
export type ScoutQueueClass = z.infer<typeof ScoutQueueClassSchema>;

export const ScoutQueueCanaryInputSchema = z.object({
  stage: ScoutStageSchema,
  canaryId: OpaqueIdentifierSchema,
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
    taskQueue: z.string().min(1),
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

/**
 * Whether a rediscovered match's ingestion child is confirmed COMPLETED, and
 * its discovering account's cursor therefore moved past the match.
 *
 * `reconciled` means the child reached a terminal COMPLETED status, which it
 * only does once every ingestion effect has run — so the match's evidence is
 * captured and the run may carry on and settle. `not-completed` covers every
 * other status: the execution may still be mid-ingest, so the caller must not
 * advance anything or settle on it.
 */
export const IngestedMatchCursorReconciliationSchema = z.object({
  outcome: z.enum(["reconciled", "not-completed"]),
});
export type IngestedMatchCursorReconciliation = z.infer<
  typeof IngestedMatchCursorReconciliationSchema
>;

export const PostMatchDiscoveryResultSchema = z.object({
  matches: z.array(ScoutMatchIngestionInputSchema.omit({ stage: true })),
  // Old activity completions predate this field and only returned after a
  // complete discovery. Defaulting those replayed payloads to true preserves
  // in-flight workflow compatibility across the rollout.
  evidenceComplete: z.boolean().default(true),
  // Optional for activity payload compatibility during rollout. New discovery
  // binds deadline settlement to this poll-start completion watermark.
  evidenceWatermark: z.iso.datetime().optional(),
});
export type PostMatchDiscoveryResult = z.infer<
  typeof PostMatchDiscoveryResultSchema
>;

export const ScoutPostMatchMaintenanceInputSchema =
  ScoutPostMatchDiscoveryInputSchema.extend({
    settleDareV2Deadlines: z.boolean(),
    evidenceWatermark: z.iso.datetime().optional(),
    /**
     * Which poll this maintenance may close, by the instant it was claimed at.
     *
     * Present only for a V2 discovery, whose poll is claimed durably and spans
     * the whole Workflow: the close is guarded on this identity, so a run
     * whose claim was taken over fails loudly instead of marking a later run's
     * poll complete. Absent for v1, whose poll and maintenance are one
     * Activity and whose close overwrites whatever stands, exactly as it
     * always has — optional rather than required so an in-flight v1 history
     * that recorded no such field still parses.
     */
    pollOwner: z.iso.datetime().optional(),
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
export type ScoutScheduleOwnershipMemo = z.infer<
  typeof ScoutScheduleOwnershipMemoSchema
>;
