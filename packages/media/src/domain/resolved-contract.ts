import { z } from "zod";

const Integer = z.number().int();
export const SourceQualitySchema = z.object({
  id: Integer.nonnegative(),
  name: z.string(),
  source: z.string(),
  resolution: Integer.nonnegative(),
  modifier: z.string().optional(),
});
const QualityLeafSchema = z.object({
  quality: SourceQualitySchema,
  allowed: z.boolean(),
  items: z.array(z.never()),
});
const QualityGroupSchema = z.object({
  id: Integer.nonnegative(),
  name: z.string(),
  allowed: z.boolean(),
  items: z.array(QualityLeafSchema).min(1),
});
export const SourceProfileSchema = z.object({
  id: Integer.positive(),
  name: z.string().min(1),
  upgradeAllowed: z.boolean(),
  cutoff: Integer.nonnegative(),
  minFormatScore: Integer,
  cutoffFormatScore: Integer,
  minUpgradeFormatScore: Integer.nonnegative(),
  language: z.object({ id: Integer, name: z.string() }).optional(),
  items: z.array(z.union([QualityLeafSchema, QualityGroupSchema])).min(1),
  formatItems: z.array(
    z.object({ format: Integer.positive(), name: z.string(), score: Integer }),
  ),
});
export const FormatSpecificationSchema = z.object({
  name: z.string(),
  implementation: z.string(),
  negate: z.boolean(),
  required: z.boolean(),
  fields: z.array(z.object({ name: z.string(), value: z.json() })),
});
export const CustomFormatSchema = z.object({
  id: Integer.positive(),
  name: z.string(),
  includeCustomFormatWhenRenaming: z.boolean(),
  specifications: z.array(FormatSpecificationSchema),
});
export const QualityDefinitionSchema = z.object({
  quality: SourceQualitySchema,
  title: z.string(),
  weight: z.number(),
  minSize: z.number().nonnegative().nullable().optional(),
  maxSize: z.number().nonnegative().nullable().optional(),
  preferredSize: z.number().nonnegative().nullable().optional(),
});
export const SourceInventorySchema = z.object({
  source: z.enum(["radarr", "sonarr"]),
  version: z.string().min(1),
  properPreference: z.enum(["preferAndUpgrade", "doNotUpgrade", "doNotPrefer"]),
  profiles: z.array(SourceProfileSchema),
  customFormats: z.array(CustomFormatSchema),
  qualityDefinitions: z.array(QualityDefinitionSchema),
});
export const ResolvedProfileSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(["radarr", "sonarr"]),
  sourceVersion: z.string(),
  sourceCommit: z.string().regex(/^[a-f\d]{40}$/),
  capturedAt: z.iso.datetime(),
  snapshotHash: z.string().regex(/^[a-f\d]{64}$/),
  properPreference: SourceInventorySchema.shape.properPreference,
  profile: SourceProfileSchema,
  customFormats: z.array(CustomFormatSchema),
  qualityDefinitions: z.array(QualityDefinitionSchema),
});
export const ResolvedReleaseSchema = z.object({
  id: z.string().min(1),
  qualityId: Integer.nonnegative(),
  identityConfirmed: z.boolean(),
  // These are source-normalized values, not guessed from the displayed title.
  releaseTitle: z.string().max(4096).nullable(),
  filename: z.string().max(4096).nullable(),
  releaseGroup: z.string().max(256).nullable(),
  sizeBytes: Integer.positive().nullable(),
  runtimeMinutes: Integer.positive().nullable(),
  audioLanguages: z.array(z.string()).nullable(),
  originalLanguage: z.string().nullable(),
  revision: z
    .object({ version: Integer.positive(), real: Integer.nonnegative() })
    .nullable(),
  specialEpisode: z.boolean(),
});
export type ResolvedProfile = z.infer<typeof ResolvedProfileSchema>;
export type ResolvedRelease = z.infer<typeof ResolvedReleaseSchema>;
export type SourceInventory = z.infer<typeof SourceInventorySchema>;
export type FormatSpecification = z.infer<typeof FormatSpecificationSchema>;
export type SourceQuality = z.infer<typeof SourceQualitySchema>;
export type Match = "match" | "no_match" | "unknown";
/** A bounded .NET IgnoreCase matcher, or a verified source observation. Never JS regex. */
export type RegexMatcher = (pattern: string, value: string) => Match;
