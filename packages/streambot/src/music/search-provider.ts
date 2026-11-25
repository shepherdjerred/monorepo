import { z } from "zod";
import {
  MusicProviderSchema,
  MusicTrackSchema,
} from "@shepherdjerred/streambot/music/contracts.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import { isYouTubeMusicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import {
  musicProviderDroppedItemsTotal,
  type MusicProviderOperation,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";

/** The providers an operator can select with `streambot-music-search-provider`. */
export const MusicSearchProviderNameSchema = z.enum([
  "youtube-music",
  "musicbrainz",
]);
export type MusicSearchProviderName = z.infer<
  typeof MusicSearchProviderNameSchema
>;

/** The code default; the Flags declaration carries the same value for production and beta. */
export const DEFAULT_MUSIC_SEARCH_PROVIDER: MusicSearchProviderName =
  "youtube-music";

export type MusicSearchKind = "song" | "video" | "album" | "artist";

/** An album as search or an artist page lists it; the id is opaque outside its provider. */
export const MusicAlbumHitSchema = z
  .strictObject({
    kind: z.literal("album"),
    provider: MusicProviderSchema,
    id: z.string().min(1).max(100),
    title: z.string().min(1),
    artists: z.array(z.string().min(1)),
    year: z
      .string()
      .regex(/^\d{4}$/u)
      .optional(),
    artworkId: z.uuid().optional(),
    artworkUrl: z.string().optional(),
  })
  .refine(
    (album) =>
      album.artworkUrl === undefined ||
      isYouTubeMusicArtworkUrl(album.artworkUrl),
    {
      path: ["artworkUrl"],
      message: "Album artwork must be a YouTube image host URL",
    },
  );
export type MusicAlbumHit = z.infer<typeof MusicAlbumHitSchema>;

export const MusicArtistHitSchema = z
  .strictObject({
    kind: z.literal("artist"),
    provider: MusicProviderSchema,
    id: z.string().min(1).max(100),
    name: z.string().min(1),
    artworkUrl: z.string().optional(),
  })
  .refine(
    (artist) =>
      artist.artworkUrl === undefined ||
      isYouTubeMusicArtworkUrl(artist.artworkUrl),
    {
      path: ["artworkUrl"],
      message: "Artist artwork must be a YouTube image host URL",
    },
  );
export type MusicArtistHit = z.infer<typeof MusicArtistHitSchema>;

export const MusicSongHitSchema = z.strictObject({
  kind: z.enum(["song", "video"]),
  track: MusicTrackSchema,
});
export type MusicSongHit = z.infer<typeof MusicSongHitSchema>;

export const MusicSearchHitSchema = z.union([
  MusicSongHitSchema,
  MusicAlbumHitSchema,
  MusicArtistHitSchema,
]);
export type MusicSearchHit = z.infer<typeof MusicSearchHitSchema>;

export type MusicSearchPage = {
  readonly items: readonly MusicSearchHit[];
  /** The query the provider searched instead of what was typed; never logged. */
  readonly correctedQuery?: string;
};

export type MusicAlbumDetail = {
  readonly album: MusicAlbumHit;
  readonly tracks: readonly z.infer<typeof MusicTrackSchema>[];
};

export type MusicArtistDetail = {
  readonly artist: MusicArtistHit;
  readonly songs: readonly z.infer<typeof MusicTrackSchema>[];
  readonly albums: readonly MusicAlbumHit[];
};

/** A provider with no typeahead says so instead of returning a misleading empty list. */
export type MusicSuggestions =
  | { readonly kind: "suggestions"; readonly items: readonly string[] }
  | { readonly kind: "unsupported" };

export type MusicSearchProvider = {
  readonly name: MusicSearchProviderName;
  readonly search: (
    kind: MusicSearchKind,
    query: string,
    signal: AbortSignal,
  ) => Promise<MusicSearchPage>;
  readonly suggestions: (
    prefix: string,
    signal: AbortSignal,
  ) => Promise<MusicSuggestions>;
  readonly albumTracks: (
    id: string,
    signal: AbortSignal,
  ) => Promise<MusicAlbumDetail>;
  readonly artistTop: (
    id: string,
    signal: AbortSignal,
  ) => Promise<MusicArtistDetail>;
};

/** The metric operation for a search of one kind. */
export const SEARCH_OPERATIONS = {
  song: "search_song",
  video: "search_video",
  album: "search_album",
  artist: "search_artist",
} as const satisfies Record<MusicSearchKind, MusicProviderOperation>;

/**
 * Why a provider call failed. `invalid_response` means the provider answered but nothing in the
 * answer passed validation, which is schema drift rather than an outage.
 */
export type MusicSearchFailure = "unavailable" | "timeout" | "invalid_response";

export class MusicSearchError extends Error {
  constructor(
    readonly failure: MusicSearchFailure,
    options?: ErrorOptions,
  ) {
    // Never the query, ids or titles: this message reaches logs.
    super("Music search provider call failed: " + failure, options);
    this.name = "MusicSearchError";
  }
}

/**
 * Validate every raw item on its own. An item that fails is dropped and counted; a response whose
 * items all fail is a provider error, never an empty list that hides drift.
 */
export function validateItems<T>(input: {
  readonly provider: MusicSearchProviderName;
  readonly operation: MusicProviderOperation;
  readonly raw: readonly unknown[];
  readonly parse: (item: unknown) => T;
}): T[] {
  const valid: T[] = [];
  let dropped = 0;
  for (const item of input.raw) {
    try {
      valid.push(input.parse(item));
    } catch {
      dropped += 1;
    }
  }
  if (dropped > 0)
    musicProviderDroppedItemsTotal.inc(
      { provider: input.provider, operation: input.operation },
      dropped,
    );
  if (input.raw.length > 0 && valid.length === 0)
    throw new MusicSearchError("invalid_response");
  return valid;
}

/** Providers keyed by name, with the active one chosen per call so a flag flip needs no restart. */
export class MusicSearchProviders {
  constructor(
    private readonly providers: Readonly<
      Record<MusicSearchProviderName, MusicSearchProvider>
    >,
    private readonly selected: (scope: DiscoveryScope) => Promise<string>,
  ) {}

  /** An unknown configured value is a broken contract: it throws instead of picking a default. */
  async current(scope: DiscoveryScope): Promise<MusicSearchProvider> {
    const name = MusicSearchProviderNameSchema.parse(
      await this.selected(scope),
    );
    return this.providers[name];
  }
}
