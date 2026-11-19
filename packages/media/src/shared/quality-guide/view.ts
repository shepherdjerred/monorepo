import { z } from "zod";
import { QualityRulesSchema } from "#shared/api.ts";
import { GuideKindSchema, GuideOverridesSchema } from "./contract.ts";

export const QualityGuidePreviewResultSchema = z.object({
  kind: GuideKindSchema,
  name: z.string(),
  revision: z.string(),
  contentHash: z.string(),
  rules: QualityRulesSchema,
});
export const QualityGuideSyncSchema = z.object({
  status: z.enum(["updated", "unchanged", "deferred", "failed"]),
  at: z.iso.datetime(),
  revision: z.string().nullable(),
  reason: z.string().nullable(),
});
export const QualityGuideStatusSchema = z
  .array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      version: z.int().nonnegative(),
      kind: GuideKindSchema,
      revision: z.string(),
      contentHash: z.string(),
      lastSync: QualityGuideSyncSchema.nullable(),
      scoreOverrides: GuideOverridesSchema,
    }),
  )
  .max(25);
export const QualityGuideApplyResultSchema = z.strictObject({
  profileId: z.uuid(),
  version: z.int().nonnegative(),
  status: z.literal("completed"),
});
