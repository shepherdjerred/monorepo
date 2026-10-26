import { MusicCatalog } from "@shepherdjerred/streambot/music/catalog.ts";
import { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import { SpotifyMetadata } from "@shepherdjerred/streambot/music/spotify.ts";
import {
  MusicAlbumSchema,
  type MusicTrack,
} from "@shepherdjerred/streambot/music/contracts.ts";

export const ARTIST = "e9eafc07-7bb7-4e77-9814-4d139a94889d";
export const ALBUM = "aa997ea0-2936-40bd-884d-3af8a0e064dc";
export const RELEASE = "db66e369-1173-4b9a-b545-bd8aa99652ac";
export const SONG: MusicTrack = {
  provider: "musicbrainz",
  id: "c461c911-9c58-4a2f-bbdb-7761cb065fb4",
  title: "Get Lucky",
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationSeconds: 369,
  artworkId: ALBUM,
  canonicalUrl:
    "https://musicbrainz.org/recording/c461c911-9c58-4a2f-bbdb-7761cb065fb4",
};
class FixtureCatalog extends MusicCatalog {
  override browse(params: URLSearchParams) {
    return params.has("artist")
      ? Promise.resolve({
          offset: 0,
          total: 1,
          items: [
            {
              kind: "album" as const,
              id: ALBUM,
              title: "Random Access Memories",
              subtitle: "Album · 2013",
              artworkId: ALBUM,
            },
          ],
        })
      : Promise.resolve({
          offset: 0,
          total: 3,
          items: [
            {
              kind: "artist" as const,
              id: ARTIST,
              title: "Daft Punk",
              subtitle: "French electronic duo",
            },
            {
              kind: "album" as const,
              id: ALBUM,
              title: "Random Access Memories",
              subtitle: "Daft Punk",
              artworkId: ALBUM,
            },
            {
              kind: "song" as const,
              id: SONG.id,
              title: SONG.title,
              subtitle: "Daft Punk",
              track: SONG,
            },
          ],
        });
  }
  override album() {
    return Promise.resolve(
      MusicAlbumSchema.parse({
        id: ALBUM,
        title: "Random Access Memories",
        artist: "Daft Punk",
        releaseId: RELEASE,
        editions: [{ id: RELEASE, label: "2013 · US · Official" }],
        tracks: [
          SONG,
          {
            ...SONG,
            id: "1ebc2c28-f1bb-4e43-826a-0ce144ab35b1",
            title: "Instant Crush",
            durationSeconds: 337,
          },
        ],
      }),
    );
  }
}
class FixtureSpotify extends SpotifyMetadata {
  override load() {
    return Promise.resolve({
      title: "Evening mix",
      tracks: [
        {
          ...SONG,
          provider: "spotify" as const,
          id: "5nTtCOCds6I0PHMNtqelas",
          canonicalUrl: "https://open.spotify.com/track/5nTtCOCds6I0PHMNtqelas",
        },
      ],
      complete: null,
      warning: "Spotify may expose an incomplete public playlist.",
    });
  }
}
export function fixtureMusic() {
  return new MusicService(new FixtureCatalog(), new FixtureSpotify(), (query) =>
    Promise.resolve([
      {
        title: query.includes("Instant Crush") ? "Instant Crush" : SONG.title,
        channel: "Daft Punk - Topic",
        url: "https://www.youtube.com/watch?v=h5EofwRzit0",
        durationSeconds: query.includes("Instant Crush") ? 337 : 369,
      },
    ]),
  );
}
