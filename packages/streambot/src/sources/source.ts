import { z } from "zod";

/**
 * Per-request subtitle preference, set from the `/stream play` `subtitles`/`sublang` options.
 * Both fields optional: `enabled === undefined` falls back to `config.subtitles.enabled`, and
 * `language === undefined` falls back to `config.subtitles.languages`.
 */
export const SubtitlePrefSchema = z.strictObject({
  enabled: z.boolean().optional(),
  language: z.string().min(1).optional(),
});

export type SubtitlePref = z.infer<typeof SubtitlePrefSchema>;

/**
 * A requested playback source, before resolution. `file` is a concrete local path; `url` is any
 * yt-dlp-supported link; `search` is a yt-dlp search query resolved to a video at play time. Each
 * variant may carry an optional per-request subtitle preference.
 */
export const SourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("file"),
    path: z.string().min(1),
    title: z.string().min(1),
    subtitles: SubtitlePrefSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.url(),
    subtitles: SubtitlePrefSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("search"),
    query: z.string().min(1),
    subtitles: SubtitlePrefSchema.optional(),
  }),
]);

export type Source = z.infer<typeof SourceSchema>;

/** A short human label for a source, for queue/status embeds. */
export function sourceLabel(source: Source): string {
  switch (source.kind) {
    case "file": {
      return source.title;
    }
    case "url": {
      return source.url;
    }
    case "search": {
      return source.query;
    }
  }
}
