import { describe, expect, test, vi } from "vitest";
import { MusicCatalog } from "@shepherdjerred/streambot/music/catalog.ts";
import { MusicBrainzProvider } from "@shepherdjerred/streambot/music/musicbrainz-provider.ts";
import { fixtureMusic, ALBUM, ARTIST, SONG } from "#music-fixture";

const signal = new AbortController().signal;
const provider = () => new MusicBrainzProvider(fixtureMusic().catalog);

describe("MusicBrainz behind the provider interface", () => {
  test("songs, albums and artists map to provider-neutral hits", async () => {
    const songs = await provider().search("song", "daft punk", signal);
    expect(songs.items).toContainEqual({ kind: "song", track: SONG });
    const albums = await provider().search("album", "daft punk", signal);
    expect(albums.items).toContainEqual(
      expect.objectContaining({
        kind: "album",
        provider: "musicbrainz",
        id: ALBUM,
        title: "Random Access Memories",
        artists: ["Daft Punk"],
        artworkId: ALBUM,
      }),
    );
    const artists = await provider().search("artist", "daft punk", signal);
    expect(artists.items).toContainEqual({
      kind: "artist",
      provider: "musicbrainz",
      id: ARTIST,
      name: "Daft Punk",
    });
  });

  test("it has no music videos and no typeahead", async () => {
    await expect(
      provider().search("video", "daft punk", signal),
    ).resolves.toEqual({ items: [] });
    await expect(provider().suggestions()).resolves.toEqual({
      kind: "unsupported",
    });
  });

  test("an album page lists its tracks and carries the cover art id", async () => {
    const detail = await provider().albumTracks(ALBUM, signal);
    expect(detail.album).toMatchObject({ id: ALBUM, artworkId: ALBUM });
    expect(detail.tracks.map((track) => track.title)).toEqual([
      "Get Lucky",
      "Instant Crush",
    ]);
  });

  test("an id from another provider is refused as stale", async () => {
    await expect(
      provider().albumTracks("MPREb_K8qWMWVqXGi", signal),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(
      provider().artistTop("UCRr1xG_2WIDs18a6cIiCxeA", signal),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  test("an artist page combines the artist's recordings with their release groups", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/artist/"))
        return Promise.resolve(Response.json({ name: "Daft Punk" }));
      if (url.includes("/recording?"))
        return Promise.resolve(
          Response.json({
            recordings: [
              {
                id: SONG.id,
                title: "Get Lucky",
                length: 369_000,
                "artist-credit": [{ name: "Daft Punk" }],
              },
            ],
          }),
        );
      return Promise.resolve(
        Response.json({
          "release-group-count": 1,
          "release-groups": [
            {
              id: ALBUM,
              title: "Random Access Memories",
              "primary-type": "Album",
            },
          ],
        }),
      );
    });
    const detail = await new MusicBrainzProvider(
      new MusicCatalog(fetcher),
    ).artistTop(ARTIST, signal);
    expect(detail.artist).toMatchObject({ id: ARTIST, name: "Daft Punk" });
    expect(detail.songs.map((song) => song.title)).toEqual(["Get Lucky"]);
    expect(detail.albums.map((album) => album.id)).toEqual([ALBUM]);
  }, 15_000);
});
