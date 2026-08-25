import { z } from "zod";

export const ScoutStageSchema = z.enum(["dev", "beta", "prod"]);
export type ScoutStage = z.infer<typeof ScoutStageSchema>;

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
    "competition-validation",
    "player-pruning",
    "removed-guild-cleanup",
    "match-time-rebuild",
    "outreach",
    "conversion-check",
    "summoner-index-backfill",
    "prediction-ingest",
    "legacy-backfill",
  ]),
});
export type ScoutBackgroundJobInput = z.infer<
  typeof ScoutBackgroundJobInputSchema
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
});
export type ScoutReportRunInput = z.infer<typeof ScoutReportRunInputSchema>;

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

export const InitialHistoryPageResultSchema = z.object({
  nextCursor: z.string().min(1).max(512).optional(),
  persistedMatches: z.number().int().nonnegative(),
  complete: z.boolean(),
});
export type InitialHistoryPageResult = z.infer<
  typeof InitialHistoryPageResultSchema
>;

export const PostMatchDiscoveryResultSchema = z.object({
  matchIds: z.array(OpaqueIdentifierSchema),
});
export type PostMatchDiscoveryResult = z.infer<
  typeof PostMatchDiscoveryResultSchema
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

export const ScoutScheduleOwnershipMemoSchema = z.object({
  owner: z.literal("scout-for-lol"),
  stage: ScoutStageSchema,
  reportId: OpaqueIdentifierSchema,
  schemaVersion: z.literal(1),
});
export type ScoutScheduleOwnershipMemo = z.infer<
  typeof ScoutScheduleOwnershipMemoSchema
>;
