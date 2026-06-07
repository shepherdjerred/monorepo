import { z } from "zod";

/**
 * A requested playback source, before resolution. `file` is a concrete local path; `url` is any
 * yt-dlp-supported link; `search` is a yt-dlp search query resolved to a video at play time.
 */
export const SourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("file"),
    path: z.string().min(1),
    title: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("url"), url: z.url() }),
  z.strictObject({ kind: z.literal("search"), query: z.string().min(1) }),
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
