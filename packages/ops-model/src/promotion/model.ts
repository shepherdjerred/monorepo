import { z } from "zod";

export const PromotionHistoryEntrySchema = z.object({
  id: z.string(),
  batchId: z.string().nullable(),
  targetId: z.string(),
  mode: z.enum(["preview", "run", "reconcile", "cleanup", "unknown"]),
  status: z.string(),
  summary: z.string(),
  at: z.string(),
  timeBasis: z.enum(["execution", "report-saved", "attempt"]),
  finishedAt: z.string().nullable(),
  occurrenceId: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  evidenceId: z.string().nullable(),
  costUsd: z.number().nullable(),
  cleanup: z.string().nullable(),
});
export type PromotionHistoryEntry = z.infer<typeof PromotionHistoryEntrySchema>;
export const PromotionBatchSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  pid: z.number(),
  interrupted: z.boolean().optional(),
  mode: z.enum(["preview", "run", "reconcile", "cleanup"]),
  scope: z.enum(["all", "selected"]).optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
  entries: z.array(
    z.object({
      targetId: z.string(),
      effectiveMode: z
        .enum(["preview", "run", "reconcile", "cleanup"])
        .optional(),
      status: z.enum(["queued", "running", "completed", "skipped", "failed"]),
      phase: z.string(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
      occurrenceId: z.string().nullable(),
      summary: z.string(),
    }),
  ),
});
export type PromotionBatch = z.infer<typeof PromotionBatchSchema>;
export const PromotionRunRowSchema = z.object({
  targetId: z.string(),
  name: z.string(),
  platform: z.string(),
  url: z.string(),
  health: z.enum(["working", "disabled", "error", "checking"]),
  outcome: z.enum([
    "done",
    "not_due",
    "disabled",
    "error",
    "running",
    "queued",
    "not_run",
  ]),
  reason: z.string(),
  detail: z.string(),
  initialDetail: z.string().nullable(),
  intervention: z.enum(["retried", "corrected", "cleanup"]).nullable(),
  knownGood: z.boolean(),
  receiptUrl: z.string().nullable(),
  evidenceId: z.string().nullable(),
  nextAllowedAt: z.string().nullable(),
});
export type PromotionRunRow = z.infer<typeof PromotionRunRowSchema>;
export const PromotionRunSummarySchema = z.object({
  batchId: z.string().nullable(),
  scope: z.enum(["all", "selected"]).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  status: z.enum(["passed", "attention", "running", "interrupted", "not_run"]),
  followUpCount: z.number().int().nonnegative(),
  counts: z.object({
    done: z.number().int().nonnegative(),
    notDue: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    interventions: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    notRun: z.number().int().nonnegative(),
  }),
  rows: z.array(PromotionRunRowSchema),
});
export type PromotionRunSummary = z.infer<typeof PromotionRunSummarySchema>;
export const PromotionOverviewSchema = z.object({
  version: z.literal(1),
  readAt: z.string(),
  scheduling: z.enum(["manual", "scheduled"]),
  lastRun: PromotionRunSummarySchema,
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      platform: z.string(),
      url: z.string(),
      action: z.string(),
      notes: z.string(),
      constraint: z.string(),
      nextAllowedAt: z.string().nullable(),
      latest: PromotionHistoryEntrySchema.nullable(),
      preview: PromotionHistoryEntrySchema.nullable(),
      lastAction: PromotionHistoryEntrySchema.nullable(),
    }),
  ),
  batches: z.array(PromotionBatchSchema.extend({ interrupted: z.boolean() })),
  spend: z
    .object({
      day: z.string(),
      aiUsd: z.number(),
      captchaUsd: z.number(),
      pendingCaptchaUsd: z.number(),
      unknownAi: z.number(),
      allocatedAiUsd: z.number().nonnegative().default(0),
      unallocatedUnknownAi: z.number().int().nonnegative().optional(),
    })
    .transform((spend) => ({
      ...spend,
      // v1 producers predate reviewed allocations; every unknown still blocks.
      unallocatedUnknownAi: spend.unallocatedUnknownAi ?? spend.unknownAi,
    })),
});
export type PromotionOverview = z.infer<typeof PromotionOverviewSchema>;
export const PromotionHistoryResponseSchema = z.object({
  items: z.array(PromotionHistoryEntrySchema),
  nextCursor: z.string().nullable(),
});
