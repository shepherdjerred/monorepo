import { expect, test } from "vitest";
import {
  musicArtworkUrl,
  isSpotifyArtworkUrl,
} from "@shepherdjerred/streambot/music/artwork.ts";
import { MusicTrackSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { SourceSchema } from "@shepherdjerred/streambot/sources/source.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { SpotifyMetadata } from "@shepherdjerred/streambot/music/spotify.ts";
import { WebArtwork } from "@shepherdjerred/streambot/web/server/artwork.ts";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import { renderPlayerCard } from "@shepherdjerred/streambot/discord/player-card/player-card.ts";
import { musicBrowserView } from "@shepherdjerred/streambot/discord/music-view.ts";
import { IDLE_VIEW } from "@shepherdjerred/streambot/session/session-types.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import { SONG, ALBUM } from "#music-fixture";

const COVER =
  "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273baf89eb11ec7c657805d2da0";
test.each([
  "https://evil.example/image/a",
  "http://i.scdn.co/image/a",
  "https://i.scdn.co.evil.example/image/a",
  "https://user@i.scdn.co/image/a",
  "https://i.scdn.co/image/a?secret=x",
  "https://i.scdn.co/other/a",
])("unsupported cover URLs cannot be persisted or rendered: %s", (url) => {
  expect(isSpotifyArtworkUrl(url)).toBe(false);
  expect(isRemoteArtworkUrl(url)).toBe(false);
  expect(MusicTrackSchema.safeParse({ ...SONG, artworkUrl: url }).success).toBe(
    false,
  );
});
test("web and Discord choose album art ahead of a YouTube thumbnail", () => {
  const source = SourceSchema.parse(
    musicSource(SONG, "https://www.youtube.com/watch?v=h5EofwRzit0"),
  );
  const thumbnail = "https://i.ytimg.com/vi/h5EofwRzit0/hqdefault.jpg";
  expect(
    new WebArtwork(() => [], undefined).forSource(source, "guild", thumbnail),
  ).toBe(musicArtworkUrl(SONG, "guild"));
  const view: PlaybackView = {
    ...IDLE_VIEW,
    current: {
      title: SONG.title,
      requesterId: UserIdSchema.parse("100000000000000099"),
      chapters: [],
      kind: "url",
      mediaKind: "music",
      sourceId: "music:test",
      durationSeconds: 369,
      source,
      provenance: { provider: "youtube", thumbnailUrl: thumbnail },
    },
  };
  const input = { view, posterUrl: null, enabled: true, finished: false };
  expect(renderPlayerCard(input).embed?.thumbnailUrl).toBe(
    musicArtworkUrl(SONG),
  );
  expect(renderPlayerCard({ ...input, enabled: false }).embed?.imageUrl).toBe(
    musicArtworkUrl(SONG),
  );
  const browser = musicBrowserView({
    title: "Album",
    description: "Daft Punk",
    items: [],
    previous: false,
    next: false,
    queueAll: false,
    url: undefined,
    artworkUrl: musicArtworkUrl({ artworkId: ALBUM }),
  });
  expect(browser.embeds[0]?.toJSON().thumbnail?.url).toBe(
    musicArtworkUrl(SONG),
  );
});
test.each(["track", "album", "playlist"] as const)(
  "Spotify %s metadata retains an album cover only when it identifies the track",
  async (type) => {
    const song = {
      uri: "spotify:track:5nTtCOCds6I0PHMNtqelas",
      title: "Get Lucky",
      subtitle: "Daft Punk",
      duration: 369_000,
    };
    const entity = {
      ...song,
      type,
      name: "Music",
      uri: "spotify:" + type + ":5nTtCOCds6I0PHMNtqelas",
      coverArt: { sources: [{ url: COVER, width: 300 }] },
      ...(type === "track" ? {} : { trackList: [song] }),
    };
    const html =
      '<html><body><script id="__NEXT_DATA__">' +
      JSON.stringify({
        props: { pageProps: { state: { data: { entity } } } },
      }) +
      "</script></body></html>";
    const provider = new SpotifyMetadata(
      Object.assign(() => Promise.resolve(new Response(html)), {
        preconnect: fetch.preconnect,
      }),
    );
    const result = await provider.load(
      "https://open.spotify.com/" + type + "/5nTtCOCds6I0PHMNtqelas",
      AbortSignal.timeout(1000),
    );
    expect(result.tracks[0]?.artworkUrl).toBe(
      type === "playlist" ? undefined : COVER,
    );
    if (type !== "playlist") {
      const source = SourceSchema.parse(musicSource(result.tracks[0] ?? SONG));
      expect(
        new WebArtwork(() => [], undefined).forSource(source, "guild"),
      ).toBe(COVER);
    }
  },
);
