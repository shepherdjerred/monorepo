import { z } from "zod";
import { SourceQualitySchema } from "#domain/resolved-contract.ts";
import selections from "./selection.json" with { type: "json" };

const Id = z.string().regex(/^[a-f0-9]{32}$/u);
export const GuideFormatSchema = z.object({
  trash_id: Id,
  name: z.string().min(1).max(200),
  trash_scores: z.record(z.string(), z.int()).optional(),
  includeCustomFormatWhenRenaming: z.boolean(),
  specifications: z
    .array(
      z.object({
        name: z.string().max(200),
        implementation: z.string().max(100),
        negate: z.boolean(),
        required: z.boolean(),
        fields: z.record(z.string(), z.json()),
      }),
    )
    .min(1)
    .max(200),
});
export const GuideSizesSchema = z.object({
  trash_id: Id,
  type: z.enum(["movie", "series"]),
  qualities: z
    .array(
      z.object({
        quality: z.string(),
        min: z.number().nonnegative(),
        preferred: z.number().nonnegative(),
        max: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
});
export const GuideSourceProfileSchema = z.object({
  trash_id: Id,
  trash_score_set: z.string().min(1),
  language: z.literal("Original"),
});
export const GuideBundleSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/u),
  committedAt: z.iso.datetime(),
  formats: z.array(GuideFormatSchema).min(1).max(100),
  sizes: GuideSizesSchema,
  profile: GuideSourceProfileSchema.optional(),
});
const PresetSchema = z.object({
  source: z.enum(["radarr", "sonarr"]),
  sourceVersion: z.string(),
  name: z.string(),
  qualitySizePath: z.string(),
  profilePath: z.string().optional(),
  profileId: Id.optional(),
  formats: z
    .array(z.object({ id: Id, path: z.string(), score: z.int().optional() }))
    .min(1)
    .max(100),
  qualities: z.array(SourceQualitySchema),
  ladder: z
    .array(z.object({ name: z.string(), members: z.array(z.string()).min(1) }))
    .min(1),
  cutoff: z.string(),
  sizeOverrides: z.array(
    z.object({
      name: z.string(),
      max: z.number().positive(),
      preferred: z.number().positive(),
    }),
  ),
});
export const GUIDE_PRESETS = z
  .object({
    schemaVersion: z.literal(1),
    presets: z.object({
      movie: PresetSchema,
      series: PresetSchema,
    }),
  })
  .parse(selections).presets;
export type GuideBundle = z.infer<typeof GuideBundleSchema>;
export type GuidePreset = z.infer<typeof PresetSchema>;
