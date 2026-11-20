import { Innertube, Log, Parser } from "youtubei.js";
import { z } from "zod";
import type { MusicTrack } from "@shepherdjerred/streambot/music/contracts.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import {
  MusicAlbumHitSchema,
  MusicArtistHitSchema,
  MusicSearchError,
  SEARCH_OPERATIONS,
  validateItems,
  type MusicAlbumDetail,
  type MusicAlbumHit,
  type MusicArtistDetail,
  type MusicSearchHit,
  type MusicSearchKind,
  type MusicSearchPage,
  type MusicSearchProvider,
  type MusicSuggestions,
} from "@shepherdjerred/streambot/music/search-provider.ts";
import {
  abortable,
  CoalescingCache,
  Slots,
} from "@shepherdjerred/streambot/music/call-limits.ts";
import {
  albumFromItem,
  AlbumResponseSchema,
  ALBUM_ID,
  ARTIST_ID,
  ArtistResponseSchema,
  artistFromItem,
  ItemTypeSchema,
  largest,
  normalizeQuery,
  present,
  SearchResponseSchema,
  ShelfSchema,
  SuggestionSchema,
  SuggestionSectionSchema,
  trackFromItem,
  yearOf,
} from "@shepherdjerred/streambot/music/youtube-music-items.ts";
import { musicProviderDroppedItemsTotal } from "@shepherdjerred/streambot/observability/web-metrics.ts";

/**
 * YouTube Music search through `youtubei.js`, an unofficial client of a private API.
 *
 * Containment: this is the only importer of `youtubei.js`; every item is re-validated against a
 * strict schema; a response nothing validates in is a typed error; parser nodes the client cannot
 * read are counted rather than logged (its log lines can carry the query). Playback never uses the
 * client: it only produces `https://music.youtube.com/watch?v=<id>` identities that yt-dlp resolves.
 */

const SEARCH_TIMEOUT_MS = 5000;
const SUGGEST_TIMEOUT_MS = 2000;
const BROWSE_TIMEOUT_MS = 5000;
/** One upstream HTTP request; the per-call deadline is what a caller waits for. */
const HTTP_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_CALLS = 4;
/** Callers waiting for a slot; the next one is refused as unavailable. */
const MAX_WAITING_CALLS = 16;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_ENTRIES = 300;
const MAX_ARTIST_ALBUMS = 20;
const MAX_SUGGESTIONS = 20;

export type YouTubeMusicOptions = {
  /** The transport for every upstream request; tests replay recorded responses through it. */
  readonly fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  /** `local` builds the session without the bootstrap request; for tests only. */
  readonly session?: "remote" | "local";
  /** Per-call deadlines in milliseconds; tests shorten them. */
  readonly deadlines?: Partial<Record<"search" | "suggest" | "browse", number>>;
};

let quieted = false;

/** Process-wide and idempotent: the library's logger and parser hooks are module state. */
function quietLibrary(): void {
  if (quieted) return;
  quieted = true;
  Log.setLevel(Log.Level.NONE);
  Parser.setParserErrorHandler(() => {
    musicProviderDroppedItemsTotal.inc({
      provider: "youtube-music",
      operation: "parser",
    });
  });
}

function staleId(): MusicError {
  return new MusicError(
    404,
    "not_found",
    "This music page is no longer available.",
  );
}

function hitFor(kind: MusicSearchKind, item: unknown): MusicSearchHit {
  if (kind === "album") return albumFromItem(item);
  return kind === "artist"
    ? artistFromItem(item)
    : { kind, track: trackFromItem(item, undefined) };
}

export class YouTubeMusicProvider implements MusicSearchProvider {
  readonly name = "youtube-music" as const;
  private readonly slots = new Slots(MAX_CONCURRENT_CALLS, MAX_WAITING_CALLS);
  private readonly searches = new CoalescingCache<MusicSearchPage>(
    CACHE_ENTRIES,
    CACHE_TTL_MS,
  );
  private readonly typeahead = new CoalescingCache<MusicSuggestions>(
    CACHE_ENTRIES,
    CACHE_TTL_MS,
  );
  private readonly albums = new CoalescingCache<MusicAlbumDetail>(
    CACHE_ENTRIES,
    CACHE_TTL_MS,
  );
  private readonly artists = new CoalescingCache<MusicArtistDetail>(
    CACHE_ENTRIES,
    CACHE_TTL_MS,
  );
  private client: Promise<Innertube> | undefined;

  constructor(private readonly options: YouTubeMusicOptions = {}) {}

  readonly search = async (
    kind: MusicSearchKind,
    query: string,
    signal: AbortSignal,
  ): Promise<MusicSearchPage> => {
    const key = kind + "|" + normalizeQuery(query);
    return await this.searches.resolve(key, signal, async () => {
      const deadline = this.options.deadlines?.search ?? SEARCH_TIMEOUT_MS;
      const parsed = SearchResponseSchema.safeParse(
        await this.call(deadline, (yt) =>
          yt.music.search(query, { type: kind }),
        ),
      );
      if (!parsed.success) throw new MusicSearchError("invalid_response");
      // Only shelves hold results; a corrected query leads with an `ItemSection` that does not.
      const raw = present(parsed.data.contents).flatMap((section) => {
        const shelf = ShelfSchema.safeParse(section);
        return shelf.success && shelf.data.type === "MusicShelf"
          ? present(shelf.data.contents)
          : [];
      });
      const items = validateItems<MusicSearchHit>({
        provider: this.name,
        operation: SEARCH_OPERATIONS[kind],
        raw,
        parse: (item) => hitFor(kind, item),
      });
      const corrected = parsed.data.showing_results_for?.corrected_query?.text;
      const changed =
        corrected !== undefined &&
        normalizeQuery(corrected) !== normalizeQuery(query);
      const page = { items, ...(changed ? { correctedQuery: corrected } : {}) };
      return page;
    });
  };

  readonly suggestions = async (
    prefix: string,
    signal: AbortSignal,
  ): Promise<MusicSuggestions> => {
    const key = normalizeQuery(prefix);
    return await this.typeahead.resolve(key, signal, async () => {
      const deadline = this.options.deadlines?.suggest ?? SUGGEST_TIMEOUT_MS;
      const sections = z
        .array(SuggestionSectionSchema)
        .safeParse(
          await this.call(deadline, (yt) =>
            yt.music.getSearchSuggestions(prefix),
          ),
        );
      if (!sections.success) throw new MusicSearchError("invalid_response");
      const texts = validateItems<string>({
        provider: this.name,
        operation: "suggest",
        // Sections also carry direct-result shortcuts (songs, artists); only suggestions count here.
        raw: sections.data
          .flatMap((section) => present(section.contents))
          .filter(
            (item) =>
              ShelfSchema.safeParse(item).data?.type === "SearchSuggestion",
          ),
        parse: (item) => SuggestionSchema.parse(item).suggestion.text,
      });
      const result: MusicSuggestions = {
        kind: "suggestions",
        items: [...new Set(texts)].slice(0, MAX_SUGGESTIONS),
      };
      return result;
    });
  };

  readonly albumTracks = async (
    id: string,
    signal: AbortSignal,
  ): Promise<MusicAlbumDetail> => {
    if (!ALBUM_ID.test(id)) throw staleId();
    return await this.albums.resolve(id, signal, async () => {
      const deadline = this.options.deadlines?.browse ?? BROWSE_TIMEOUT_MS;
      const response = AlbumResponseSchema.safeParse(
        await this.call(deadline, (yt) => yt.music.getAlbum(id)),
      );
      if (!response.success) throw new MusicSearchError("invalid_response");
      const { header } = response.data;
      // The album's tracks come back typed as videos with an empty artist list.
      const strapline = header.strapline_text_one;
      const credited = (strapline?.runs ?? [])
        .filter((run) => run.endpoint !== undefined && run.text.trim() !== "")
        .map((run) => run.text);
      const fallbackArtist =
        strapline === undefined || strapline.text.trim() === ""
          ? []
          : [strapline.text];
      const artists = credited.length > 0 ? credited : fallbackArtist;
      const artworkUrl = largest(header.thumbnail?.contents);
      const year = yearOf(header.subtitle?.text);
      const album = MusicAlbumHitSchema.safeParse({
        kind: "album",
        provider: this.name,
        id,
        title: header.title.text,
        artists,
        ...(year === undefined ? {} : { year }),
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
      });
      if (!album.success) throw new MusicSearchError("invalid_response");
      const tracks = validateItems<MusicTrack>({
        provider: this.name,
        operation: "album",
        raw: present(response.data.contents),
        parse: (item) => trackFromItem(item, { artists, artworkUrl }),
      });
      return { album: album.data, tracks };
    });
  };

  readonly artistTop = async (
    id: string,
    signal: AbortSignal,
  ): Promise<MusicArtistDetail> => {
    if (!ARTIST_ID.test(id)) throw staleId();
    return await this.artists.resolve(id, signal, async () => {
      const deadline = this.options.deadlines?.browse ?? BROWSE_TIMEOUT_MS;
      const response = ArtistResponseSchema.safeParse(
        await this.call(deadline, (yt) => yt.music.getArtist(id)),
      );
      if (!response.success) throw new MusicSearchError("invalid_response");
      const shelves = present(response.data.sections).flatMap((section) => {
        const shelf = ShelfSchema.safeParse(section);
        return shelf.success ? [shelf.data] : [];
      });
      // Top songs are the first plain shelf and carry no durations; albums sit in carousels.
      const topSongs = shelves.find((shelf) => shelf.type === "MusicShelf");
      const songs = validateItems<MusicTrack>({
        provider: this.name,
        operation: "artist",
        raw: present(topSongs?.contents),
        parse: (item) => trackFromItem(item, undefined),
      });
      const albums = validateItems<MusicAlbumHit>({
        provider: this.name,
        operation: "artist",
        raw: shelves
          .filter((shelf) => shelf.type === "MusicCarouselShelf")
          .flatMap((shelf) => present(shelf.contents))
          .filter((item) => {
            const kind = ItemTypeSchema.safeParse(item);
            return kind.success && kind.data.item_type === "album";
          }),
        parse: albumFromItem,
      }).slice(0, MAX_ARTIST_ALBUMS);
      const artworkUrl = largest(response.data.header.thumbnail?.contents);
      const artist = MusicArtistHitSchema.safeParse({
        kind: "artist",
        provider: this.name,
        id,
        name: response.data.header.title.text,
        ...(artworkUrl === undefined ? {} : { artworkUrl }),
      });
      if (!artist.success) throw new MusicSearchError("invalid_response");
      return { artist: artist.data, songs, albums };
    });
  };

  private async innertube(): Promise<Innertube> {
    const pending = (this.client ??= this.createClient());
    try {
      return await pending;
    } catch (error) {
      // A failed bootstrap must not poison every later call.
      if (this.client === pending) this.client = undefined;
      throw error;
    }
  }

  private async createClient(): Promise<Innertube> {
    quietLibrary();
    const transport = this.options.fetch ?? globalThis.fetch;
    return await Innertube.create({
      retrieve_player: false,
      generate_session_locally: this.options.session === "local",
      fetch: Object.assign(
        (input: string | URL | Request, init?: RequestInit) => {
          const deadline = AbortSignal.timeout(HTTP_TIMEOUT_MS);
          return transport(input, {
            ...init,
            signal:
              init?.signal === undefined || init.signal === null
                ? deadline
                : AbortSignal.any([init.signal, deadline]),
          });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    });
  }

  /** The upstream call itself: it holds its slot until it really ends. */
  private async upstream<T>(
    signal: AbortSignal,
    task: (client: Innertube) => Promise<T>,
  ): Promise<T> {
    const release = await this.slots.acquire(signal);
    try {
      return await task(await this.innertube());
    } finally {
      release();
    }
  }

  /**
   * One upstream call with bounded concurrency and a deadline that includes waiting its turn. It
   * belongs to every caller sharing it, so only its own deadline ends it.
   */
  private async call<T>(
    timeoutMs: number,
    task: (client: Innertube) => Promise<T>,
  ): Promise<unknown> {
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      return await abortable(this.upstream(deadline, task), deadline);
    } catch (error) {
      if (deadline.aborted) throw new MusicSearchError("timeout");
      if (error instanceof MusicSearchError || error instanceof MusicError)
        throw error;
      throw new MusicSearchError("unavailable", { cause: error });
    }
  }
}
