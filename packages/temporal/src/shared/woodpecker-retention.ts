import { z } from "zod/v4";

export const RetentionPipelineSchema = z.object({
  number: z.number().int().positive(),
  status: z.enum([
    "pending",
    "running",
    "blocked",
    "success",
    "failure",
    "error",
    "killed",
    "declined",
    "skipped",
  ]),
  created: z.number().int().nonnegative(),
  finished: z.number().int().nonnegative(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  branch: z.string().min(1),
  ref: z.string(),
});
export const RetentionRepoSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[^/]+\/[^/]+$/),
  default_branch: z.string().min(1),
});
export const RetentionCandidateSchema = z.object({
  repo: RetentionRepoSchema,
  pipeline: RetentionPipelineSchema,
  logEntries: z.number().int().positive(),
});
export const RetentionReceiptSchema = z.object({
  candidate: RetentionCandidateSchema,
  outcome: z.enum([
    "dry-run",
    "deleted",
    "already-empty",
    "protected",
    "changed",
    "disabled",
  ]),
});
export type RetentionPipeline = z.infer<typeof RetentionPipelineSchema>;
export type RetentionRepo = z.infer<typeof RetentionRepoSchema>;
export type RetentionCandidate = z.infer<typeof RetentionCandidateSchema>;
export type RetentionReceipt = z.infer<typeof RetentionReceiptSchema>;
export type RetentionCursor = {
  repoIndex: number;
  page: number;
  offset?: number | undefined;
};
export type RetentionPlanInput = {
  repos: RetentionRepo[];
  cursor: RetentionCursor;
  cutoff: number;
  remaining: number;
};
export type RetentionApplyInput = {
  candidates: RetentionCandidate[];
  cutoff: number;
  dryRun: boolean;
};
export const RETENTION_BATCH_LIMIT = 100;
export const RETENTION_RUN_LIMIT = 1000;
export const RetentionCheckpointSchema = z.object({
  repos: z.array(RetentionRepoSchema),
  cutoff: z.number().int().positive(),
  cursor: z.object({
    repoIndex: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    offset: z.number().int().min(0).max(99).optional(),
  }),
});
export const RetentionManifestSchema = z.object({
  cutoff: z.number().int().positive(),
  candidates: z.array(RetentionCandidateSchema).max(RETENTION_RUN_LIMIT),
});
export const RetentionRunInputSchema = z.object({
  dryRun: z.boolean().default(true),
  resumeScheduled: z.boolean().default(false),
  reviewedPlan: RetentionManifestSchema.optional(),
});
export const RetentionRunResultSchema = z.object({
  manifest: RetentionManifestSchema,
  receipts: z.array(RetentionReceiptSchema).max(RETENTION_RUN_LIMIT),
  continuation: RetentionCheckpointSchema.nullable(),
  scanned: z.number().int().min(0).max(RETENTION_RUN_LIMIT),
  protectAllMain: z.boolean(),
  protectionReasons: z.array(z.string()).max(100),
  dryRun: z.boolean(),
});
export type RetentionRunInput = z.input<typeof RetentionRunInputSchema>;
export type RetentionRunResult = z.infer<typeof RetentionRunResultSchema>;

export function retentionEligible(
  repo: RetentionRepo,
  pipeline: RetentionPipeline,
  cutoff: number,
  protection: {
    heads: ReadonlySet<string>;
    protectAllMain?: boolean;
    numbers?: ReadonlySet<number>;
  },
): boolean {
  return (
    !["pending", "running", "blocked"].includes(pipeline.status) &&
    pipeline.created < cutoff &&
    pipeline.finished > 0 &&
    pipeline.finished < cutoff &&
    (protection.protectAllMain === false ||
      (pipeline.branch !== "main" &&
        pipeline.branch !== repo.default_branch)) &&
    !protection.heads.has(pipeline.commit) &&
    protection.numbers?.has(pipeline.number) !== true
  );
}
