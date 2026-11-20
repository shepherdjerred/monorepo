import { z } from "zod";
import type { MusicCatalog } from "@shepherdjerred/streambot/music/catalog.ts";
import {
  MusicEntitySchema,
  type MusicEntity,
} from "@shepherdjerred/streambot/music/contracts.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import {
  MusicAlbumHitSchema,
  MusicArtistHitSchema,
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

const PAGE_SIZE = 20;
const ARTIST_SONGS = 10;

function entityHit(entity: MusicEntity): MusicSearchHit {
  if (entity.kind === "song") {
    if (entity.track === undefined)
      throw new Error("A song entity carries a track");
    return { kind: "song", track: entity.track };
  }
  if (entity.kind === "artist")
    return MusicArtistHitSchema.parse({
      kind: "artist",
      provider: "musicbrainz",
      id: entity.id,
      name: entity.title,
    });
  return albumHit(entity);
}

function albumHit(entity: MusicEntity): MusicAlbumHit {
  return MusicAlbumHitSchema.parse({
    kind: "album",
    provider: "musicbrainz",
    id: entity.id,
    title: entity.title,
    // The catalog's subtitle is the artist credit, or the word "Album" when it has none.
    artists:
      entity.subtitle === "" || entity.subtitle === "Album"
        ? []
        : [entity.subtitle],
    ...(entity.artworkId === undefined ? {} : { artworkId: entity.artworkId }),
  });
}

/** The existing MusicBrainz catalog behind the provider interface; it has no typeahead or videos. */
export class MusicBrainzProvider implements MusicSearchProvider {
  readonly name = "musicbrainz" as const;
  constructor(private readonly catalog: MusicCatalog) {}

  async search(
    kind: MusicSearchKind,
    query: string,
    signal: AbortSignal,
  ): Promise<MusicSearchPage> {
    // MusicBrainz has recordings, release groups and artists, but no music videos.
    if (kind === "video") return { items: [] };
    const page = await this.catalog.browse(
      new URLSearchParams({ query, type: kind, limit: String(PAGE_SIZE) }),
      signal,
    );
    return {
      items: validateItems({
        provider: this.name,
        operation: SEARCH_OPERATIONS[kind],
        // The catalog is asked for one type; anything else in the page is not this group.
        raw: page.items.filter((entity) => entity.kind === kind),
        parse: (entity) => entityHit(MusicEntitySchema.parse(entity)),
      }),
    };
  }

  suggestions(): Promise<MusicSuggestions> {
    return Promise.resolve({ kind: "unsupported" });
  }

  async albumTracks(
    id: string,
    signal: AbortSignal,
  ): Promise<MusicAlbumDetail> {
    if (!z.uuid().safeParse(id).success) throw staleId();
    const album = await this.catalog.album(id, undefined, signal);
    return {
      album: MusicAlbumHitSchema.parse({
        kind: "album",
        provider: this.name,
        id,
        title: album.title,
        artists: album.artist === "" ? [] : [album.artist],
        artworkId: id,
      }),
      tracks: album.tracks,
    };
  }

  async artistTop(id: string, signal: AbortSignal): Promise<MusicArtistDetail> {
    if (!z.uuid().safeParse(id).success) throw staleId();
    const artist = await this.catalog.artist(id, signal);
    const [songs, albums] = await Promise.all([
      this.catalog.artistRecordings(artist.name, signal, ARTIST_SONGS),
      this.catalog.browse(
        new URLSearchParams({ artist: id, limit: String(PAGE_SIZE) }),
        signal,
      ),
    ]);
    return {
      artist: MusicArtistHitSchema.parse({
        kind: "artist",
        provider: this.name,
        id,
        name: artist.name,
      }),
      songs,
      albums: validateItems({
        provider: this.name,
        operation: "artist",
        raw: albums.items,
        parse: (entity) => albumHit(MusicEntitySchema.parse(entity)),
      }),
    };
  }
}

function staleId(): MusicError {
  return new MusicError(
    404,
    "not_found",
    "This music page is no longer available.",
  );
}
