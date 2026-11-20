import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import { MusicError } from "@shepherdjerred/streambot/music/errors.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import {
  MusicSearchError,
  type MusicSearchKind,
  type MusicSearchProvider,
} from "@shepherdjerred/streambot/music/search-provider.ts";
import {
  BrowsePageSchema,
  type BrowsePage,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { Group } from "./observe.ts";
import { GROUP_LIMIT, type SearchContext, type SearchDeps } from "./context.ts";
import {
  albumRow,
  artistRow,
  bothActions,
  joined,
  pastedUrl,
  songRow,
} from "./rows.ts";

/** A provider outage is one group's problem and says so in the same words every time. */
export function rethrowProviderFailure(error: unknown): never {
  if (error instanceof MusicSearchError)
    throw new MusicError(
      503,
      "music_search_unavailable",
      "Music search is unavailable right now.",
    );
  throw error;
}

const SINGULAR = {
  songs: "song",
  albums: "album",
  artists: "artist",
} as const satisfies Record<string, MusicSearchKind>;

/** Songs, albums or artists from the selected provider. */
export async function musicGroup(input: {
  deps: SearchDeps;
  context: SearchContext;
  provider: MusicSearchProvider;
  kind: keyof typeof SINGULAR;
  query: string;
}): Promise<Group> {
  const { deps, context, provider, query } = input;
  // A pasted link is not a music query, and an empty query has nothing to ask a provider.
  if (query === "" || pastedUrl(query) !== null) return { items: [] };
  const page = await provider.search(
    SINGULAR[input.kind],
    query,
    context.signal,
  );
  return {
    items: page.items.slice(0, GROUP_LIMIT).map((hit) => {
      if (hit.kind === "album") return albumRow(hit, context.guildId);
      if (hit.kind === "artist") return artistRow(hit);
      return songRow({
        track: hit.track,
        token: deps.music.add(context.session, context.guildId, [
          musicSource(hit.track),
        ]),
        guildId: context.guildId,
        listenAllowed: context.listen,
      });
    }),
    correctedQuery: page.correctedQuery,
  };
}

/** Row selections per album page; the owner's token capacity is 200 including the album's own. */
const ALBUM_ROW_LIMIT = 150;

/** An album page: every track, and one selection that queues them all as a single request. */
export async function albumPage(
  deps: SearchDeps,
  context: SearchContext,
  provider: MusicSearchProvider,
  id: string,
): Promise<BrowsePage> {
  const { session, guildId } = context;
  const { album, tracks } = await provider.albumTracks(id, context.signal);
  const artwork = musicArtworkUrl(album, guildId);
  // Row selections are issued first and the whole-album one last, so the newest token always
  // survives the per-owner capacity; rows stop short of that capacity so none is evicted either.
  const rows = tracks.slice(0, ALBUM_ROW_LIMIT).map((track) =>
    songRow({
      track,
      token: deps.music.add(session, guildId, [musicSource(track)]),
      guildId,
      listenAllowed: context.listen,
    }),
  );
  return BrowsePageSchema.parse({
    header: {
      kind: "album",
      id: album.id,
      title: album.title,
      subtitle: joined([album.artists.join(", "), album.year]),
      ...(artwork === undefined ? {} : { artworkUrl: artwork }),
    },
    ...(tracks.length === 0
      ? {}
      : {
          play: {
            id: deps.music.add(
              session,
              guildId,
              tracks.map((track) => musicSource(track)),
            ),
            actions: bothActions("listen", context.listen),
          },
        }),
    rows,
  });
}

/** An artist page: top songs, then albums. */
export async function artistPage(
  deps: SearchDeps,
  context: SearchContext,
  provider: MusicSearchProvider,
  id: string,
): Promise<BrowsePage> {
  const { session, guildId } = context;
  const { artist, songs, albums } = await provider.artistTop(
    id,
    context.signal,
  );
  return BrowsePageSchema.parse({
    header: {
      kind: "artist",
      id: artist.id,
      title: artist.name,
      ...(artist.artworkUrl === undefined
        ? {}
        : { artworkUrl: artist.artworkUrl }),
    },
    rows: [
      ...songs.map((track) =>
        songRow({
          track,
          token: deps.music.add(session, guildId, [musicSource(track)]),
          guildId,
          listenAllowed: context.listen,
        }),
      ),
      ...albums.map((album) => albumRow(album, guildId)),
    ],
  });
}
