import { z } from "zod";

export const SubtitleMatchKeyV1Schema = z.enum([
  "title",
  "series",
  "year",
  "season",
  "episode",
  "source",
  "edition",
  "release_group",
  "audio_codec",
  "resolution",
  "video_codec",
  "hearing_impaired",
  "streaming_service",
]);
export const SUBTITLE_MATCH_WEIGHTS_V1: Readonly<
  Record<
    "episode" | "movie",
    Readonly<Partial<Record<z.infer<typeof SubtitleMatchKeyV1Schema>, number>>>
  >
> = {
  episode: {
    series: 160,
    year: 90,
    season: 30,
    episode: 30,
    source: 25,
    release_group: 20,
    audio_codec: 1,
    resolution: 1,
    video_codec: 1,
    hearing_impaired: 1,
    streaming_service: 1,
  },
  movie: {
    title: 60,
    year: 40,
    source: 30,
    edition: 30,
    release_group: 15,
    audio_codec: 1,
    resolution: 1,
    video_codec: 1,
    hearing_impaired: 1,
    streaming_service: 1,
  },
};
export const SubtitleMatchScoreV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    weights: z.literal("bazarr-1.6.2"),
    matcher: z.literal("media-evidence-v1"),
    kind: z.enum(["episode", "movie"]),
    score: z.int().nonnegative(),
    maximum: z.union([z.literal(360), z.literal(180)]),
    matches: z.array(SubtitleMatchKeyV1Schema).max(13),
    referenceHash: z.string().regex(/^[a-f0-9]{64}$/u),
    catalogStatus: z.enum(["confirmed", "conflict", "unconfirmed"]),
  })
  .refine(
    (value) =>
      value.maximum === (value.kind === "episode" ? 360 : 180) &&
      new Set(value.matches).size === value.matches.length &&
      value.matches.every(
        (key) => SUBTITLE_MATCH_WEIGHTS_V1[value.kind][key] !== undefined,
      ) &&
      value.score ===
        value.matches.reduce(
          (sum, key) => sum + (SUBTITLE_MATCH_WEIGHTS_V1[value.kind][key] ?? 0),
          0,
        ),
    "Score does not match its observed source weight catalog",
  );
export type SubtitleMatchScoreV1 = z.infer<typeof SubtitleMatchScoreV1Schema>;
export type SubtitleMatchKeyV1 = z.infer<typeof SubtitleMatchKeyV1Schema>;
export function subtitleScorePercent(value: SubtitleMatchScoreV1): number {
  const score = SubtitleMatchScoreV1Schema.parse(value);
  return (score.score / score.maximum) * 100;
}
export const SubtitleScoreReferenceV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(["episode", "movie"]),
  title: z.string().min(1).max(300),
  year: z.int().positive().nullable(),
  season: z.int().nonnegative().nullable(),
  episode: z.int().positive().nullable(),
  sourceFilename: z.string().min(1).max(1000),
  quality: z.string().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  imdbId: z
    .string()
    .regex(/^tt\d+$/u)
    .nullable(),
  tmdbId: z.int().positive().nullable(),
  edition: z.string().min(1).max(100),
});
export type SubtitleScoreReferenceV1 = z.infer<
  typeof SubtitleScoreReferenceV1Schema
>;
export const SubtitleCatalogEvidenceV1Schema = z.strictObject({
  kind: z.enum(["movie", "series"]),
  imdbId: z
    .string()
    .regex(/^tt\d+$/u)
    .nullable(),
  tmdbId: z.int().positive().nullable(),
  season: z.int().nonnegative().nullable(),
  episode: z.int().positive().nullable(),
});
export type SubtitleCatalogEvidenceV1 = z.infer<
  typeof SubtitleCatalogEvidenceV1Schema
>;
export const SubtitleUpgradeV1Schema = z.strictObject({
  oldSubtitleId: z.uuid(),
  oldVersion: z.int().nonnegative(),
  oldChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  minimumScore: SubtitleMatchScoreV1Schema,
});
export type SubtitleUpgradeV1 = z.infer<typeof SubtitleUpgradeV1Schema>;
