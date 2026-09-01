import { z } from "zod";

export const TemporalNamespaceSchema = z.enum(["dev", "beta", "prod"]);
export type TemporalNamespace = z.infer<typeof TemporalNamespaceSchema>;

export const ScoutStageSchema = TemporalNamespaceSchema;
export type ScoutStage = TemporalNamespace;

export const TemporalLegacyNamespaceSchema = z.literal("default");
export type TemporalLegacyNamespace = z.infer<
  typeof TemporalLegacyNamespaceSchema
>;

export const DETACHED_WORK_MAX_ATTEMPTS = 4;

const OpaqueIdentifierSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Z0-9][\w.:-]*$/i);

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
  sourcePuuid: OpaqueIdentifierSchema,
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
  puuid: OpaqueIdentifierSchema,
  cursor: z.string().min(1).max(512).optional(),
  runOnStart: z.boolean().optional(),
  pagesProcessed: z.number().int().nonnegative().default(0),
  pagesInCurrentRun: z.number().int().nonnegative().default(0),
});
export type ScoutInitialHistoryInput = z.infer<
  typeof ScoutInitialHistoryInputSchema
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
  ]),
});
export type ScoutBackgroundJobInput = z.infer<
  typeof ScoutBackgroundJobInputSchema
>;

export const ScoutDetachedWorkInputSchema = z.object({
  stage: ScoutStageSchema,
  kind: z.literal("parlay-generation"),
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
  initialHistoryPuuids: z.array(OpaqueIdentifierSchema),
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

export const PostMatchDiscoveryResultSchema = z.object({
  matches: z.array(ScoutMatchIngestionInputSchema.omit({ stage: true })),
  // Old activity completions predate this field and only returned after a
  // complete discovery. Defaulting those replayed payloads to true preserves
  // in-flight workflow compatibility across the rollout.
  evidenceComplete: z.boolean().default(true),
});
export type PostMatchDiscoveryResult = z.infer<
  typeof PostMatchDiscoveryResultSchema
>;

export const ScoutPostMatchMaintenanceInputSchema =
  ScoutPostMatchDiscoveryInputSchema.extend({
    settleDareV2Deadlines: z.boolean(),
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
