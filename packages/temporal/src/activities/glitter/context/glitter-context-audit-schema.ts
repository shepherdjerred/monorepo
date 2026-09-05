import { z } from "zod/v4";
import { GlitterCorpusSnapshotPinSchema } from "./glitter-context-refresh-corpus.ts";

export const GlitterContextAuditInputSchema = z
  .object({
    now: z.iso.datetime({ offset: true }).optional(),
    snapshot: GlitterCorpusSnapshotPinSchema.optional(),
  })
  .strict();
export type GlitterContextAuditInput = z.input<
  typeof GlitterContextAuditInputSchema
>;

const GlitterContextAuditBlockedStageSchema = z.discriminatedUnion("stage", [
  z
    .object({
      stage: z.literal("style-synthesis"),
      personId: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      stage: z.literal("relationships"),
      reason: z.string().min(1),
    })
    .strict(),
]);
export type GlitterContextAuditBlockedStage = z.infer<
  typeof GlitterContextAuditBlockedStageSchema
>;

export const GlitterContextAuditResultSchema = z
  .object({
    snapshotId: z.uuid(),
    snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
    eligiblePeople: z.array(z.string().min(1)),
    cacheHits: z.number().int().nonnegative(),
    cacheMisses: z.number().int().nonnegative(),
    blockedStages: z.array(GlitterContextAuditBlockedStageSchema),
    artifactKeys: z.array(z.string().min(1)),
    worstCaseUncachedCostUsd: z.number().nonnegative(),
  })
  .strict();
export type GlitterContextAuditResult = z.infer<
  typeof GlitterContextAuditResultSchema
>;
