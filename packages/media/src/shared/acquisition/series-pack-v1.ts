import { z } from "zod";
import {
  AcquisitionIdentitySnapshotSchema,
  CanonicalIdentitySchema,
} from "./identity.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const SeriesSeasonSetV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("explicit_season_range"),
    raw: z.string().min(1).max(4096),
    start: z.int().positive().max(999),
    end: z.int().positive().max(999),
    seasons: z.array(z.int().positive().max(999)).min(2).max(100),
  })
  .refine((range) => {
    const token = /^S(?<start>\d{1,3})[ ._]*-[ ._]*S(?<end>\d{1,3})$/iu.exec(
      range.raw,
    );
    return (
      token !== null &&
      Number(token.groups?.["start"]) === range.start &&
      Number(token.groups?.["end"]) === range.end &&
      range.end > range.start &&
      range.seasons.length === range.end - range.start + 1 &&
      range.seasons.every((season, index) => season === range.start + index)
    );
  }, "An explicit season range must retain its exact token and complete bounded contiguous set");

/** A current interpretation of literal provider bytes, not a requester or historical transfer. */
export const SeriesPackInterpretationV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    parserVersion: z.literal("series-season-range-v1"),
    releaseId: z.uuid(),
    sourceHash: Hash,
    seriesId: z.uuid(),
    canonicalHash: Hash,
    canonical: CanonicalIdentitySchema.options[1],
    range: SeriesSeasonSetV1Schema,
    profile: z.strictObject({
      id: z.uuid(),
      version: z.int().nonnegative(),
      hash: Hash,
    }),
    runtimeMinutes: z.number().positive().nullable(),
    originalLanguage: z.string().min(1).nullable(),
    attributes: PublicReleaseAttributesSchema,
  })
  .refine((value) => {
    const episodes = value.canonical.coordinates.episodes;
    const selected = episodes.map((episode) => episode.mediaId).sort();
    return (
      value.canonical.coordinates.seriesId === value.seriesId &&
      episodes.length > 0 &&
      episodes.length <= 100 &&
      episodes.every((episode) =>
        value.range.seasons.includes(episode.seasonNumber),
      ) &&
      value.range.seasons.every((season) =>
        episodes.some((episode) => episode.seasonNumber === season),
      ) &&
      value.attributes.identityConfidence === "exact" &&
      value.attributes.mediaIds.length === selected.length &&
      value.attributes.mediaIds.every((id, index) => id === selected[index])
    );
  }, "Series pack interpretation must retain exact whole-season canonical coverage");

export const SeriesPackInterpretationEnvelopeV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("assess_series_pack_v1"),
  interpretation: SeriesPackInterpretationV1Schema,
  interpretationHash: Hash,
  raw: z.string().min(1).max(131_072),
  sourceRaw: z.string().min(1).max(131_072),
  profileRaw: z.string().min(1).max(131_072),
});

/** Captured attributes are usable only after the actual immutable Operation parent is verified. */
export const CapturedSeriesPackV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  interpretationHash: Hash,
  attributes: PublicReleaseAttributesSchema,
});
export const SeriesPackSourceV1Schema =
  AcquisitionIdentitySnapshotSchema.shape.source.extend({
    seriesPackV1: CapturedSeriesPackV1Schema,
  });
export const SeriesPackSelectionV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.uuid(),
  primaryMediaId: z.uuid(),
  generation: z.int().nonnegative(),
  selected: CapturedSeriesPackV1Schema,
});

export type SeriesSeasonSetV1 = z.infer<typeof SeriesSeasonSetV1Schema>;
export type SeriesPackInterpretationV1 = z.infer<
  typeof SeriesPackInterpretationV1Schema
>;
export type CapturedSeriesPackV1 = z.infer<typeof CapturedSeriesPackV1Schema>;
