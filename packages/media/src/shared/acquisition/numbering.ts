import { z } from "zod";
import { NumberingProvenanceSchema } from "./coordinates.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const GroupId = z.string().regex(/^[\w-]{1,100}$/u);
const GroupSummary = z.strictObject({
  id: GroupId,
  name: z.string().max(2000),
  type: z.int().min(1).max(7),
  episodeCount: z.int().nonnegative().max(5000),
  groupCount: z.int().nonnegative().max(500),
});
export const NumberingGroupListSchema = z.strictObject({
  seriesId: z.uuid(),
  seriesVersion: z.int().nonnegative(),
  groups: z.array(GroupSummary).max(500),
});
export const NumberingGroupDetailSchema = z.strictObject({
  seriesId: z.uuid(),
  groupId: GroupId,
  groupDigest: Hash,
  name: z.string().max(2000),
  type: z.literal(2),
  subgroups: z
    .array(
      z.strictObject({
        id: GroupId,
        name: z.string().max(2000),
        order: z.int().nonnegative(),
        episodeCount: z.int().nonnegative().max(5000),
        firstOrder: z.int().nonnegative().nullable(),
        lastOrder: z.int().nonnegative().nullable(),
      }),
    )
    .max(500),
});
export const PreviewNumberingGroupSchema = z.strictObject({
  groupId: GroupId,
  subgroupId: GroupId,
  firstAbsoluteNumber: z.int().positive().max(100_000),
  offset: z.int().nonnegative().max(5000),
});
const Mapping = z.strictObject({
  episodeId: z.uuid(),
  expectedVersion: z.int().nonnegative(),
  title: z.string(),
  tmdbEpisodeId: z.int().positive(),
  seasonNumber: z.int().nonnegative(),
  episodeNumber: z.int().nonnegative(),
  rawOrder: z.int().nonnegative(),
  absoluteNumber: z.int().positive().max(100_000),
  previousAbsoluteNumber: z.int().positive().nullable(),
  existingProvenance: NumberingProvenanceSchema,
  requiresOverride: z.boolean(),
  provenance: NumberingProvenanceSchema,
});
export const NumberingGroupPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  seriesId: z.uuid(),
  seriesVersion: z.int().nonnegative(),
  interpretation: PreviewNumberingGroupSchema,
  groupDigest: Hash,
  catalogDigest: Hash,
  numberingDigest: Hash,
  mappings: z.array(Mapping).min(1).max(100),
  nextOffset: z.int().nonnegative().nullable(),
  previewDigest: Hash,
});
export const CommitNumberingGroupSchema = z.strictObject({
  interpretation: PreviewNumberingGroupSchema,
  previewDigest: Hash,
  groupDigest: Hash,
  catalogDigest: Hash,
  numberingDigest: Hash,
  mappings: z
    .array(
      z.strictObject({
        episodeId: z.uuid(),
        expectedVersion: z.int().nonnegative(),
        absoluteNumber: z.int().positive().max(100_000),
      }),
    )
    .min(1)
    .max(100),
  overrideEpisodeIds: z.array(z.uuid()).max(100),
});
export type PreviewNumberingGroup = z.infer<typeof PreviewNumberingGroupSchema>;
export type CommitNumberingGroup = z.infer<typeof CommitNumberingGroupSchema>;
export type NumberingGroupPreview = z.infer<typeof NumberingGroupPreviewSchema>;
