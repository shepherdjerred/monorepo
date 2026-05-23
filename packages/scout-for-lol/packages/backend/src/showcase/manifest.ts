import { z } from "zod";
import { QueueTypeSchema } from "@scout-for-lol/data";

export const ShowcaseStateSchema = z.enum(["prematch", "postmatch"]);
export type ShowcaseState = z.infer<typeof ShowcaseStateSchema>;

const BaseEntrySchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  group: z.string().min(1),
  description: z.string().min(1).optional(),
  state: ShowcaseStateSchema.optional(),
  queue: QueueTypeSchema.optional(),
  playerCount: z.number().int().positive().max(10).optional(),
});

export const S3ImageShowcaseEntrySchema = BaseEntrySchema.extend({
  kind: z.literal("s3-image"),
  imageKey: z.string().min(1),
  dataKey: z.string().min(1).optional(),
}).superRefine((entry, ctx) => {
  if (entry.dataKey !== undefined && entry.state === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["state"],
      message: "s3-image entries with dataKey must include state",
    });
  }
});

export const CompetitionGraphShowcaseEntrySchema = BaseEntrySchema.extend({
  kind: z.literal("competition-graph"),
  snapshotKeys: z.array(z.string().min(1)).min(1),
  chartType: z.enum(["line", "bar"]),
  yAxisLabel: z.string().min(1),
});

export const ReportGraphMetricSchema = z.enum([
  "kills",
  "assists",
  "deaths",
  "kda",
  "gold",
  "damage_to_champions",
  "damage_taken",
  "vision_score",
  "cs",
]);
export type ReportGraphMetric = z.infer<typeof ReportGraphMetricSchema>;

export const ReportGraphShowcaseEntrySchema = BaseEntrySchema.extend({
  kind: z.literal("report-graph"),
  matchKeys: z.array(z.string().min(1)).min(1),
  queueFilter: z.array(QueueTypeSchema).min(1).optional(),
  metric: ReportGraphMetricSchema,
  yAxisLabel: z.string().min(1),
});

export const UnsupportedShowcaseEntrySchema = BaseEntrySchema.extend({
  kind: z.literal("unsupported"),
  reason: z.string().min(1),
});

export const ShowcaseEntrySchema = z.discriminatedUnion("kind", [
  S3ImageShowcaseEntrySchema,
  CompetitionGraphShowcaseEntrySchema,
  ReportGraphShowcaseEntrySchema,
  UnsupportedShowcaseEntrySchema,
]);
export type ShowcaseEntry = z.infer<typeof ShowcaseEntrySchema>;

export const ShowcaseManifestSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(ShowcaseEntrySchema).min(1),
});
export type ShowcaseManifest = z.infer<typeof ShowcaseManifestSchema>;

const BaseGeneratedAssetSchema = BaseEntrySchema.extend({
  sourceKeys: z.array(z.string().min(1)),
});

export const GeneratedShowcaseAssetSchema = BaseGeneratedAssetSchema.extend({
  kind: z.enum(["s3-image", "competition-graph", "report-graph"]),
  status: z.literal("generated"),
  fileName: z.string().min(1),
  src: z.string().min(1),
  byteLength: z.number().int().positive(),
});

export const UnsupportedGeneratedShowcaseAssetSchema =
  BaseGeneratedAssetSchema.extend({
    kind: z.literal("unsupported"),
    status: z.literal("unsupported"),
    reason: z.string().min(1),
  });

export const ShowcaseAssetSchema = z.discriminatedUnion("status", [
  GeneratedShowcaseAssetSchema,
  UnsupportedGeneratedShowcaseAssetSchema,
]);
export type ShowcaseAsset = z.infer<typeof ShowcaseAssetSchema>;

export const ShowcaseAssetIndexSchema = z.strictObject({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  assets: z.array(ShowcaseAssetSchema).min(1),
});
export type ShowcaseAssetIndex = z.infer<typeof ShowcaseAssetIndexSchema>;

const REQUIRED_SHOWCASE_VARIANT_IDS = [
  "draft-prematch",
  "draft-postmatch",
  "ranked-solo-1-prematch",
  "ranked-solo-1-postmatch",
  "ranked-solo-2-prematch",
  "ranked-solo-2-postmatch",
  "ranked-flex-1-prematch",
  "ranked-flex-1-postmatch",
  "ranked-flex-2-prematch",
  "ranked-flex-2-postmatch",
  "ranked-flex-3-prematch",
  "ranked-flex-3-postmatch",
  "ranked-flex-4-prematch",
  "ranked-flex-4-postmatch",
  "ranked-flex-5-prematch",
  "ranked-flex-5-postmatch",
  "arena-3-prematch",
  "arena-3-postmatch",
  "aram-prematch",
  "aram-postmatch",
  "aram-mayhem-prematch",
  "aram-mayhem-postmatch",
  "competition-graph",
  "report-graph",
] as const;

export function requiredShowcaseVariantIds(): readonly string[] {
  return REQUIRED_SHOWCASE_VARIANT_IDS;
}

export function validateRequiredShowcaseCoverage(
  index: ShowcaseAssetIndex,
): void {
  const ids = new Set(index.assets.map((asset) => asset.id));
  const missing = REQUIRED_SHOWCASE_VARIANT_IDS.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Generated showcase index is missing required variants: ${missing.join(", ")}`,
    );
  }
}
