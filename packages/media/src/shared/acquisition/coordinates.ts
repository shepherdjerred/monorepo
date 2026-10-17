import { z } from "zod";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const NumberList = z.array(z.number().int().nonnegative()).min(1).max(100);
export const NumberingProvenanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("canonical") }),
  z.strictObject({
    kind: z.literal("owner"),
    operationId: z.uuid(),
    evidenceHash: Hash,
  }),
  z.strictObject({
    kind: z.literal("legacy_owner"),
    version: z.number().int().nonnegative(),
    evidence: z.string().max(2000),
  }),
  z.strictObject({
    kind: z.literal("tmdb_group"),
    groupId: z.string().min(1),
    groupDigest: Hash,
    episodeId: z.number().int().positive(),
    entryDigest: Hash,
    subgroupId: z.string().min(1),
    subgroupOrder: z.number().int(),
    episodeOrder: z.number().int(),
    firstAbsoluteNumber: z.number().int().positive(),
  }),
]);
export const EpisodeCoordinateSchema = z.strictObject({
  mediaId: z.uuid(),
  mediaVersion: z.number().int().nonnegative(),
  seriesId: z.uuid(),
  seasonNumber: z.number().int().nonnegative(),
  episodeNumber: z.number().int().nonnegative(),
  tmdbEpisodeId: z.number().int().positive().nullable(),
  absoluteNumber: z.number().int().positive().nullable(),
  numberingProvenance: NumberingProvenanceSchema,
});
export const CoordinateSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  seriesId: z.uuid(),
  seriesVersion: z.number().int().nonnegative(),
  catalogComplete: z.literal(true),
  fullSeriesNumberingDigest: Hash,
  episodes: z.array(EpisodeCoordinateSchema).min(1).max(100),
  digest: Hash,
});
export const EpisodeCoordinateFormSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("season_episodes"),
    season: z.number().int().nonnegative(),
    episodes: NumberList,
    form: z.enum(["single", "range", "list"]),
  }),
  z.strictObject({
    kind: z.literal("absolute"),
    episodes: NumberList,
    form: z.enum(["single", "range", "list"]),
  }),
  z.strictObject({
    kind: z.literal("season_pack"),
    season: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
export const EpisodeCoordinateEvidenceSchema = z.strictObject({
  forms: z.array(EpisodeCoordinateFormSchema).max(20),
  invalid: z.boolean(),
});
export const CoordinateResolutionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("resolved"),
    mediaIds: z.array(z.uuid()).min(1).max(100),
  }),
  z.strictObject({
    status: z.literal("protected"),
    reason: z.enum([
      "coordinate_unknown",
      "coordinate_invalid",
      "coordinate_conflict",
      "coordinate_unmapped",
      "coordinate_duplicate",
      "coverage_unreserved",
      "catalog_incomplete",
      "coverage_limit",
    ]),
  }),
]);
export type EpisodeCoordinate = z.infer<typeof EpisodeCoordinateSchema>;
export type CoordinateSnapshot = z.infer<typeof CoordinateSnapshotSchema>;
export type EpisodeCoordinateEvidence = z.infer<
  typeof EpisodeCoordinateEvidenceSchema
>;
export type EpisodeCoordinateForm = z.infer<typeof EpisodeCoordinateFormSchema>;
export type CoordinateResolution = z.infer<typeof CoordinateResolutionSchema>;
