import { z } from "zod";
import { MAX_MIGRATION_RECORDS } from "#shared/migration.ts";

const Id = z.int().positive();
const Text = z.string().min(1).max(4096);
const OptionalText = Text.nullable().optional();
const Year = z.int().nonnegative().nullable().optional();
const Runtime = z.number().nonnegative().nullable().optional();
const Aliases = z
  .array(z.object({ title: Text }))
  .max(500)
  .optional();
const Quality = z.object({ quality: z.object({ id: z.int().nonnegative() }) });

// These are allowlists for actual Arr resource fields, not inferred corpus identities.
export const CapturedMovieSchema = z.object({
  id: Id,
  title: Text,
  year: Year,
  tmdbId: Id,
  imdbId: OptionalText,
  alternateTitles: Aliases,
  runtime: Runtime,
  qualityProfileId: Id,
  monitored: z.boolean(),
});
export const CapturedSeriesSchema = z.object({
  id: Id,
  title: Text,
  year: Year,
  tvdbId: Id,
  tmdbId: z.int().nonnegative().optional(),
  imdbId: OptionalText,
  alternateTitles: Aliases,
  runtime: Runtime,
  qualityProfileId: Id,
  monitored: z.boolean(),
});
export const CapturedEpisodeSchema = z.object({
  id: Id,
  seriesId: Id,
  title: OptionalText,
  seasonNumber: z.int().nonnegative(),
  episodeNumber: z.int().nonnegative(),
  absoluteEpisodeNumber: z.int().nonnegative().nullable().optional(),
  episodeFileId: z.int().nonnegative(),
  monitored: z.boolean(),
});
const File = z.object({
  id: Id,
  path: Text,
  size: z.int().nonnegative(),
  quality: Quality,
});
export const CapturedMovieFileSchema = File.extend({ movieId: Id });
export const CapturedEpisodeFileSchema = File.extend({ seriesId: Id });
export const CapturePrivacyOmissionSchema = z.strictObject({
  source: z.literal("sonarr"),
  resource: z.literal("episode"),
  resourceId: Id,
  field: z.literal("title"),
  reason: z.enum(["credential_pattern", "url_value"]),
});
export const InstalledCaptureSchema = z
  .discriminatedUnion("source", [
    z.strictObject({
      schemaVersion: z.literal(2),
      source: z.literal("radarr"),
      privacyOmissions: z.array(z.never()).length(0),
      sourceVersion: Text,
      movies: z.array(CapturedMovieSchema).max(MAX_MIGRATION_RECORDS),
      files: z.array(CapturedMovieFileSchema).max(MAX_MIGRATION_RECORDS),
    }),
    z.strictObject({
      schemaVersion: z.literal(2),
      source: z.literal("sonarr"),
      privacyOmissions: z
        .array(CapturePrivacyOmissionSchema)
        .max(MAX_MIGRATION_RECORDS),
      sourceVersion: Text,
      series: z.array(CapturedSeriesSchema).max(MAX_MIGRATION_RECORDS),
      episodes: z.array(CapturedEpisodeSchema).max(MAX_MIGRATION_RECORDS),
      files: z.array(CapturedEpisodeFileSchema).max(MAX_MIGRATION_RECORDS),
    }),
  ])
  .refine(
    (capture) =>
      capture.source === "radarr" ||
      (new Set(capture.privacyOmissions.map((omission) => omission.resourceId))
        .size === capture.privacyOmissions.length &&
        capture.privacyOmissions.every((omission) =>
          capture.episodes.some(
            (episode) =>
              episode.id === omission.resourceId && episode.title === undefined,
          ),
        )),
    "Privacy omission must identify one captured episode with absent title",
  );
export type InstalledCapture = z.infer<typeof InstalledCaptureSchema>;

const Artifact = z.strictObject({
  path: z.string().regex(/^[a-z-]+\.json$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const PrivateCaptureManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  stage: z.literal("installed-catalog-unlabelled"),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  sanitization: z.literal("allowlisted-boundaries-v1"),
  privacy: z.strictObject({
    policy: z.literal("optional-episode-title-v1"),
    omittedOptionalFields: z.int().nonnegative(),
  }),
  profiles: Artifact,
  installed: Artifact,
  sources: z
    .array(
      z.strictObject({
        source: z.enum(["radarr", "sonarr"]),
        sourceVersion: Text,
        catalogRecords: z.int().nonnegative(),
        installedFiles: z.int().nonnegative(),
        profiles: z.int().nonnegative(),
        privacyOmissions: z.int().nonnegative(),
      }),
    )
    .length(2),
  observations: z.strictObject({
    releaseCandidates: z.literal("not_captured"),
    torrentMembers: z.literal("not_captured"),
    completion: z.literal("not_captured"),
    probes: z.literal("not_captured"),
    independentLabels: z.literal("not_authored"),
  }),
});
