import { z } from "zod";
import {
  MusicTrackSchema,
  youtubeMusicTrackUrl,
  type MusicTrack,
} from "@shepherdjerred/streambot/music/contracts.ts";
import { isYouTubeMusicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import { musicProviderDroppedArtworkTotal } from "@shepherdjerred/streambot/observability/web-metrics.ts";
import {
  MusicAlbumHitSchema,
  MusicArtistHitSchema,
  type MusicAlbumHit,
  type MusicArtistHit,
} from "@shepherdjerred/streambot/music/search-provider.ts";

/**
 * What `youtubei.js` hands back, read through loose schemas and rebuilt as the strict,
 * provider-neutral shapes. A node that does not read as expected throws and is dropped upstream.
 */

export const ALBUM_ID = /^MPREb_[\w-]{4,40}$/u;
export const ARTIST_ID = /^UC[\w-]{10,40}$/u;

const ThumbnailSchema = z.looseObject({ url: z.string().min(1) });
export const TextSchema = z.looseObject({ text: z.string().min(1) });
const NamedSchema = z.looseObject({ name: z.string().min(1) });
const ThumbnailsSchema = z.array(ThumbnailSchema);

const ListItemSchema = z.looseObject({
  item_type: z.string(),
  id: z.string().min(1),
  title: z.string().min(1),
  artists: z.array(NamedSchema).optional(),
  authors: z.array(NamedSchema).optional(),
  album: NamedSchema.optional(),
  duration: z.looseObject({ seconds: z.number().nonnegative() }).optional(),
  thumbnails: ThumbnailsSchema.optional(),
  flex_columns: z
    .array(
      z.looseObject({
        title: z
          .looseObject({
            runs: z
              .array(
                z.looseObject({
                  text: z.string(),
                  endpoint: z.unknown().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const ArtistListItemSchema = z.looseObject({
  item_type: z.literal("artist"),
  id: z.string().min(1),
  name: z.string().min(1),
  thumbnails: ThumbnailsSchema.optional(),
});

/** A search item keeps its images in `thumbnails`; a carousel item holds an array in `thumbnail`. */
const AlbumListItemSchema = z.looseObject({
  item_type: z.literal("album"),
  id: z.string().min(1),
  title: z.union([z.string().min(1), TextSchema]),
  artists: z.array(NamedSchema).optional(),
  authors: z.array(NamedSchema).optional(),
  author: NamedSchema.optional(),
  year: z.string().optional(),
  thumbnails: ThumbnailsSchema.optional(),
  thumbnail: z.unknown().optional(),
});

export const ItemTypeSchema = z.looseObject({ item_type: z.string() });

export const ShelfSchema = z.looseObject({
  type: z.string(),
  contents: z.array(z.unknown()).optional(),
});

export const SearchResponseSchema = z.looseObject({
  contents: z.array(z.unknown()).optional(),
  showing_results_for: z
    .looseObject({ corrected_query: TextSchema.optional() })
    .optional(),
});

const HeaderThumbnailSchema = z
  .looseObject({ contents: ThumbnailsSchema.optional() })
  .optional();

export const AlbumResponseSchema = z.looseObject({
  header: z.looseObject({
    title: TextSchema,
    strapline_text_one: z
      .looseObject({
        text: z.string(),
        runs: z
          .array(
            z.looseObject({
              text: z.string(),
              endpoint: z.unknown().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    subtitle: z.looseObject({ text: z.string() }).optional(),
    thumbnail: HeaderThumbnailSchema,
  }),
  contents: z.array(z.unknown()).optional(),
});

export const ArtistResponseSchema = z.looseObject({
  header: z.looseObject({
    title: TextSchema,
    thumbnail: HeaderThumbnailSchema,
  }),
  sections: z.array(z.unknown()).optional(),
});

export const SuggestionSectionSchema = z.looseObject({
  contents: z.array(z.unknown()).optional(),
});
export const SuggestionSchema = z.looseObject({
  suggestion: z.looseObject({ text: z.string().min(1).max(200) }),
});

/** Lower-cased, whitespace-collapsed text: the cache key for a query. */
export function normalizeQuery(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ").toLowerCase();
}

/** Drop the `null`s that trail unreadable nodes in a parsed list. */
export function present(items: readonly unknown[] | undefined): unknown[] {
  return (items ?? []).filter((item) => item !== null && item !== undefined);
}

/**
 * The largest thumbnail whose host is allowed. Artwork is cosmetic, so a URL on an unknown host is
 * left off the item and counted, rather than failing an otherwise valid item.
 */
export function largest(
  thumbnails: readonly { url: string }[] | undefined,
): string | undefined {
  const url = thumbnails?.at(-1)?.url;
  if (url === undefined) return undefined;
  if (isYouTubeMusicArtworkUrl(url)) return url;
  musicProviderDroppedArtworkTotal.inc({ provider: "youtube-music" });
  return undefined;
}

export function yearOf(text: string | undefined): string | undefined {
  return text === undefined ? undefined : /\b(\d{4})\b/u.exec(text)?.[1];
}

type ListItem = z.infer<typeof ListItemSchema>;

/**
 * An artist with no channel page is credited as plain text, so the client lists no artists. The
 * credit is then the first, unlinked run of the item's second line ("Artist • Album • 4:08").
 */
function unlinkedArtist(item: ListItem): string[] {
  const first = item.flex_columns?.[1]?.title?.runs?.[0];
  return first === undefined ||
    first.endpoint !== undefined ||
    first.text.trim() === "" ||
    first.text.trim() === "•"
    ? []
    : [first.text.trim()];
}

export type TrackFallback = {
  readonly artists: readonly string[];
  readonly artworkUrl: string | undefined;
};

export function trackFromItem(
  raw: unknown,
  fallback: TrackFallback | undefined,
): MusicTrack {
  const item = ListItemSchema.parse(raw);
  if (item.item_type !== "song" && item.item_type !== "video")
    throw new Error("Not a playable track");
  const linked = (item.artists ?? item.authors ?? []).map(
    (artist) => artist.name,
  );
  const named = linked.length > 0 ? linked : unlinkedArtist(item);
  const album = item.album?.name;
  const duration = item.duration?.seconds;
  const artwork = largest(item.thumbnails) ?? fallback?.artworkUrl;
  return MusicTrackSchema.parse({
    provider: "youtube-music",
    id: item.id,
    title: item.title,
    artists: named.length > 0 ? named : (fallback?.artists ?? []),
    canonicalUrl: youtubeMusicTrackUrl(item.id),
    ...(album === undefined ? {} : { album }),
    ...(duration === undefined ? {} : { durationSeconds: duration }),
    ...(artwork === undefined ? {} : { artworkUrl: artwork }),
  });
}

export function albumFromItem(raw: unknown): MusicAlbumHit {
  const item = AlbumListItemSchema.parse(raw);
  const carousel = ThumbnailsSchema.safeParse(item.thumbnail);
  const artwork = largest(
    item.thumbnails ?? (carousel.success ? carousel.data : undefined),
  );
  const artists = (
    item.artists ??
    item.authors ??
    (item.author === undefined ? [] : [item.author])
  ).map((artist) => artist.name);
  const year = yearOf(item.year);
  return MusicAlbumHitSchema.parse({
    kind: "album",
    provider: "youtube-music",
    id: item.id,
    title: typeof item.title === "string" ? item.title : item.title.text,
    artists,
    ...(year === undefined ? {} : { year }),
    ...(artwork === undefined ? {} : { artworkUrl: artwork }),
  });
}

export function artistFromItem(raw: unknown): MusicArtistHit {
  const item = ArtistListItemSchema.parse(raw);
  const artwork = largest(item.thumbnails);
  return MusicArtistHitSchema.parse({
    kind: "artist",
    provider: "youtube-music",
    id: item.id,
    name: item.name,
    ...(artwork === undefined ? {} : { artworkUrl: artwork }),
  });
}
