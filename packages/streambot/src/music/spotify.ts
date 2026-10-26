import { z } from "zod";
import type { MusicTrack } from "./contracts.ts";
import { MusicError } from "./errors.ts";
import { isSpotifyArtworkUrl } from "./artwork.ts";

const spotifyUrlInfoModule = z
  .object({ default: z.unknown() })
  .parse(await import("spotify-url-info"));

const TrackSchema = z.object({
  name: z.string().min(1),
  artist: z.string().min(1),
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/u),
  duration: z.number().nonnegative().optional(),
});
const DetailsSchema = z.object({
  preview: z.object({
    title: z.string(),
    type: z.enum(["track", "album", "playlist"]),
    image: z.string().optional(),
  }),
  tracks: z.array(TrackSchema),
});

export function spotifyLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "open.spotify.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  )
    return null;
  const path = url.pathname.replace(/^\/intl-[a-z]+\//u, "/");
  return /^\/(?:track|album|playlist)\/[A-Za-z0-9]+\/?$/u.test(path)
    ? "https://open.spotify.com" + path.replace(/\/$/u, "")
    : null;
}

/** Public metadata only. Never persists tokens, preview audio, raw embed HTML, or imports. */
export class SpotifyMetadata {
  private readonly api;
  constructor(fetcher: typeof fetch = fetch) {
    // Upstream's default .d.ts exports a type instead of its CJS runtime factory.
    // Keep that boundary unknown and validate both the factory and returned metadata.
    const factory = z
      .custom<(fetcher: typeof fetch) => unknown>(
        (value) => typeof value === "function",
      )
      .parse(spotifyUrlInfoModule.default);
    const value: unknown = factory(fetcher);
    this.api = z
      .object({
        getDetails: z.custom<
          (url: string, options?: RequestInit) => Promise<unknown>
        >((method) => typeof method === "function"),
      })
      .parse(value);
  }
  async load(value: string, signal: AbortSignal) {
    const url = spotifyLink(value);
    if (url === null)
      throw new MusicError(
        400,
        "spotify_link",
        "Use a public Spotify track, album, or playlist link.",
      );
    let raw: unknown;
    try {
      raw = await this.api.getDetails(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
    } catch {
      signal.throwIfAborted();
      throw new MusicError(
        422,
        "spotify_unavailable",
        "Spotify could not expose this link. Check that it is public and try again.",
      );
    }
    const parsed = DetailsSchema.safeParse(raw);
    if (!parsed.success)
      throw new MusicError(
        422,
        "spotify_metadata",
        "Spotify's public metadata could not be read. Try a YouTube link instead.",
      );
    const data = parsed.data;
    const tracks: MusicTrack[] = data.tracks.map((t) => {
      const id = t.uri.slice("spotify:track:".length);
      return {
        provider: "spotify",
        id,
        title: t.name,
        artists: [t.artist],
        canonicalUrl: "https://open.spotify.com/track/" + id,
        ...(data.preview.type === "album" ? { album: data.preview.title } : {}),
        ...(data.preview.type !== "playlist" &&
        data.preview.image !== undefined &&
        isSpotifyArtworkUrl(data.preview.image)
          ? { artworkUrl: data.preview.image }
          : {}),
        ...(t.duration === undefined
          ? {}
          : { durationSeconds: t.duration / 1000 }),
      };
    });
    return {
      title: data.preview.title,
      tracks,
      complete: data.preview.type === "track" ? true : null,
      warning:
        data.preview.type === "track"
          ? ""
          : "Spotify exposes public metadata only; collections may be incomplete (up to 100 tracks).",
    };
  }
}
