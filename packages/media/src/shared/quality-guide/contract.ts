import { z } from "zod";

export const GuideKindSchema = z.enum(["movie", "series"]);
export const GuideOverridesSchema = z.record(
  z.string().regex(/^[a-f0-9]{32}$/u),
  z.int().min(-100_000).max(100_000),
);
export const ManagedGuideSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preset: z.literal("living-room-v1"),
  kind: GuideKindSchema,
  revision: z.string().regex(/^[a-f0-9]{40}$/u),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  scoreOverrides: GuideOverridesSchema,
});
export const QualityGuidePreviewSchema = z.strictObject({
  kind: GuideKindSchema,
  scoreOverrides: GuideOverridesSchema.default({}),
});
export const QualityGuideApplySchema = QualityGuidePreviewSchema.extend({
  expectedRevision: z.string().regex(/^[a-f0-9]{40}$/u),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  profileId: z.uuid().nullable(),
  expectedVersion: z.int().nonnegative(),
});
export type QualityGuideKind = z.infer<typeof GuideKindSchema>;
export type ManagedGuide = z.infer<typeof ManagedGuideSchema>;
export type QualityGuidePreview = z.infer<typeof QualityGuidePreviewSchema>;
export type QualityGuideApply = z.infer<typeof QualityGuideApplySchema>;
export type QualityGuideActivities = {
  refreshMediaQualityGuides: () => Promise<{
    updated: number;
    unchanged: number;
    deferred: number;
    failed: number;
  }>;
};
