import { z } from "zod";
import { isSpotifyArtworkUrl, isYouTubeMusicArtworkUrl } from "./artwork.ts";

export const MusicProviderSchema = z.enum([
  "musicbrainz",
  "spotify",
  "youtube-music",
]);
export type MusicProvider = z.infer<typeof MusicProviderSchema>;

/** Attribution text for a persisted music identity. */
export const MUSIC_PROVIDER_LABELS: Readonly<Record<MusicProvider, string>> = {
  musicbrainz: "MusicBrainz",
  spotify: "Spotify",
  "youtube-music": "YouTube Music",
};

/** The one canonical page for a YouTube Music track id. */
export function youtubeMusicTrackUrl(id: string): string {
  return "https://music.youtube.com/watch?v=" + encodeURIComponent(id);
}

export const MusicTrackSchema = z
  .strictObject({
    provider: MusicProviderSchema,
    id: z.string().min(1),
    title: z.string().min(1),
    artists: z.array(z.string().min(1)).min(1),
    album: z.string().optional(),
    version: z.string().optional(),
    durationSeconds: z.number().nonnegative().optional(),
    canonicalUrl: z.url(),
    artworkId: z.uuid().optional(),
    artworkUrl: z.string().optional(),
  })
  .superRefine((track, ctx) => {
    if (track.provider !== "youtube-music") {
      if (
        track.artworkUrl !== undefined &&
        !isSpotifyArtworkUrl(track.artworkUrl)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["artworkUrl"],
          message: "Invalid input",
        });
      }
      return;
    }
    if (
      track.artworkUrl !== undefined &&
      !isYouTubeMusicArtworkUrl(track.artworkUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["artworkUrl"],
        message:
          "YouTube Music artwork must be an https YouTube image host URL",
      });
    }
    // YouTube Music ids are not MusicBrainz release groups: no Cover Art Archive lookup.
    if (track.artworkId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["artworkId"],
        message: "YouTube Music tracks carry no MusicBrainz artwork id",
      });
    }
    if (track.canonicalUrl !== youtubeMusicTrackUrl(track.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["canonicalUrl"],
        message: "YouTube Music tracks use their music.youtube.com watch URL",
      });
    }
  });
export type MusicTrack = z.infer<typeof MusicTrackSchema>;
export const MusicEntitySchema = z.strictObject({
  kind: z.enum(["artist", "album", "song"]),
  id: z.uuid(),
  title: z.string(),
  subtitle: z.string(),
  date: z.string().optional(),
  artworkId: z.uuid().optional(),
  track: MusicTrackSchema.optional(),
  selectionId: z.string().optional(),
});
export type MusicEntity = z.infer<typeof MusicEntitySchema>;
export const MusicPageSchema = z.strictObject({
  items: z.array(MusicEntitySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean().optional(),
});
export const MusicAlbumSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  artist: z.string(),
  editions: z.array(z.strictObject({ id: z.uuid(), label: z.string() })),
  releaseId: z.uuid(),
  tracks: z.array(MusicTrackSchema),
  selections: z.array(z.string()).optional(),
  selectionId: z.string().optional(),
  offset: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
});
export type MusicAlbum = z.infer<typeof MusicAlbumSchema>;
export const MusicQuerySchema = z.object({
  query: z.string().trim().max(300).default(""),
  type: z.enum(["all", "artist", "album", "song"]).default("all"),
  offset: z.coerce.number().int().nonnegative().max(100_000).default(0),
  limit: z.coerce.number().int().min(3).max(20).default(20),
  artist: z.uuid().optional(),
  album: z.uuid().optional(),
  release: z.uuid().optional(),
});
export const MusicMatchSchema = z.strictObject({
  url: z.url(),
  title: z.string(),
  channel: z.string().optional(),
  durationSeconds: z.number().optional(),
  confident: z.boolean(),
  selectionId: z.string().optional(),
});
export const MusicMatchesSchema = z.array(MusicMatchSchema);
export type MusicMatch = z.infer<typeof MusicMatchSchema>;
export const MusicFeaturesSchema = z.strictObject({
  catalog: z.boolean(),
  spotify: z.boolean(),
  playlists: z.boolean(),
});
export const QueueLoadSchema = z.strictObject({
  id: z.string(),
  state: z.enum(["loading", "ready", "cancelled", "failed"]),
  count: z.number().int().nonnegative(),
  complete: z.boolean().nullable(),
  message: z.string(),
});
