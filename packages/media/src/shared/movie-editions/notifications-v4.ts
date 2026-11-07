import { z } from "zod";
import {
  MovieAttemptOperationV4Schema,
  MovieOperationV4Schema,
} from "./lifecycle/automation-v4.ts";
import { MovieEditionHashSchema } from "./registry.ts";
import { MovieSubtitleInstallV4Schema } from "./subtitles-v4.ts";
import { MovieEditionScopeSchema } from "./registry.ts";

/** New event body; older default-only notification payloads remain literal. */
export const MoviePublicationNoticeV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  kind: z.literal("movie_publication"),
  eventKind: z.enum(["media_available", "media_upgraded"]),
  source: MovieAttemptOperationV4Schema,
  publicationHash: MovieEditionHashSchema,
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
  request: z.strictObject({
    id: z.uuid(),
    choiceId: z.uuid(),
    choiceRevision: z.int().positive(),
  }),
  asset: z.strictObject({
    id: z.uuid(),
    version: z.int().nonnegative(),
    checksum: MovieEditionHashSchema,
  }),
});
export type MoviePublicationNoticeV4 = z.infer<
  typeof MoviePublicationNoticeV4Schema
>;

export const MovieRestorationNoticeV4Schema =
  MoviePublicationNoticeV4Schema.omit({
    kind: true,
    eventKind: true,
    source: true,
  }).extend({
    kind: z.literal("movie_restoration"),
    eventKind: z.literal("media_available"),
    source: MovieOperationV4Schema,
  });
export type MovieRestorationNoticeV4 = z.infer<
  typeof MovieRestorationNoticeV4Schema
>;

export const MovieCaptionNoticeV4Schema = MoviePublicationNoticeV4Schema.omit({
  kind: true,
  eventKind: true,
  source: true,
  publicationHash: true,
}).extend({
  kind: z.literal("movie_subtitles"),
  eventKind: z.literal("subtitles_ready"),
  source: MovieSubtitleInstallV4Schema,
  captionHash: MovieEditionHashSchema,
  targetAuthority: MovieEditionHashSchema,
});
export const MovieReplacementCaptionSourceV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  scope: MovieEditionScopeSchema,
  assetId: z.uuid(),
  subtitleId: z.uuid(),
  replacementId: z.uuid(),
});
export type MovieReplacementCaptionSourceV2 = z.infer<
  typeof MovieReplacementCaptionSourceV2Schema
>;
export const MovieReplacementCaptionNoticeV4Schema =
  MovieCaptionNoticeV4Schema.omit({ kind: true, source: true }).extend({
    kind: z.literal("movie_subtitle_replacement"),
    source: MovieReplacementCaptionSourceV2Schema,
  });
export type MovieReplacementCaptionNoticeV4 = z.infer<
  typeof MovieReplacementCaptionNoticeV4Schema
>;

export const MovieNoticeV4Schema = z.discriminatedUnion("kind", [
  MoviePublicationNoticeV4Schema,
  MovieCaptionNoticeV4Schema,
  MovieRestorationNoticeV4Schema,
  MovieReplacementCaptionNoticeV4Schema,
]);
export type MovieNoticeV4 = z.infer<typeof MovieNoticeV4Schema>;
export type MovieCaptionNoticeV4 = z.infer<typeof MovieCaptionNoticeV4Schema>;

export function readMovieNoticeV4(raw: unknown): MovieNoticeV4 | null {
  const header = z.object({ kind: z.string().optional() }).parse(raw);
  return [
    "movie_publication",
    "movie_subtitles",
    "movie_restoration",
    "movie_subtitle_replacement",
  ].includes(header.kind ?? "")
    ? MovieNoticeV4Schema.parse(raw)
    : null;
}

export function movieNoticeSourceHash(payload: MovieNoticeV4) {
  return payload.kind === "movie_subtitles" ||
    payload.kind === "movie_subtitle_replacement"
    ? payload.captionHash
    : payload.publicationHash;
}

export function readMoviePublicationNoticeV4(
  raw: unknown,
): MoviePublicationNoticeV4 | null {
  const header = z.object({ kind: z.string().optional() }).parse(raw);
  return header.kind === "movie_publication"
    ? MoviePublicationNoticeV4Schema.parse(raw)
    : null;
}
