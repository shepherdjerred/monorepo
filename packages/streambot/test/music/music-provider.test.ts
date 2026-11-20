import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import {
  MUSIC_PROVIDER_LABELS,
  MusicTrackSchema,
  youtubeMusicTrackUrl,
  type MusicTrack,
} from "@shepherdjerred/streambot/music/contracts.ts";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import {
  SourceSchema,
  sourceIdentity,
} from "@shepherdjerred/streambot/sources/source.ts";
import {
  loadRoomState,
  RoomPersistence,
} from "@shepherdjerred/streambot/state/room-persistence.ts";
import {
  stateFilePath,
  type PersistedState,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";
import { SONG } from "#music-fixture";

const ytm: MusicTrack = {
  provider: "youtube-music",
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  artists: ["Rick Astley"],
  durationSeconds: 213,
  canonicalUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
};
const guildId = GuildIdSchema.parse("100000000000000001");
const channelId = ChannelIdSchema.parse("100000000000000010");
const owner = { userId: "owner", guildId: "guild" };
const dirs: string[] = [];
let history: MediaHistoryStore | undefined;
afterEach(async () => {
  history?.close();
  history = undefined;
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});

describe("music provider identity", () => {
  test("accepts youtube-music and round-trips it through Source", () => {
    expect(MusicTrackSchema.parse(ytm)).toEqual(ytm);
    const source = SourceSchema.parse(musicSource(ytm));
    const persisted = JSON.stringify(source);
    expect(SourceSchema.parse(JSON.parse(persisted))).toEqual(source);
    expect(sourceIdentity(source)).toBe("music:youtube-music:dQw4w9WgXcQ");
  });

  test("canonical URL and label are YouTube Music's", () => {
    expect(youtubeMusicTrackUrl(ytm.id)).toBe(ytm.canonicalUrl);
    expect(MUSIC_PROVIDER_LABELS["youtube-music"]).toBe("YouTube Music");
    expect(
      MusicTrackSchema.safeParse({
        ...ytm,
        canonicalUrl: "https://musicbrainz.org/recording/dQw4w9WgXcQ",
      }).success,
    ).toBe(false);
  });

  test("no MusicBrainz or Cover Art Archive artwork for youtube-music", () => {
    const withArt = { ...ytm, artworkId: SONG.artworkId };
    expect(MusicTrackSchema.safeParse(withArt).success).toBe(false);
    expect(musicArtworkUrl(ytm)).toBeUndefined();
    expect(musicArtworkUrl(withArt, "guild")).toBeUndefined();
  });

  test("existing providers parse unchanged and keep their artwork", () => {
    expect(MusicTrackSchema.parse(SONG)).toEqual(SONG);
    const spotify = {
      provider: "spotify",
      id: "5nTtCOCds6I0PHMNtqelas",
      title: "Song",
      artists: ["Artist"],
      canonicalUrl: "https://open.spotify.com/track/5nTtCOCds6I0PHMNtqelas",
    };
    expect(MusicTrackSchema.parse(spotify)).toEqual(spotify);
    expect(musicArtworkUrl(SONG)).toContain("coverartarchive.org");
  });

  test("an unknown provider is still rejected", () => {
    for (const provider of ["youtube_music", "YouTube Music", "deezer", ""])
      expect(MusicTrackSchema.safeParse({ ...ytm, provider }).success).toBe(
        false,
      );
    expect(
      SourceSchema.safeParse({
        ...musicSource(ytm),
        music: { ...ytm, provider: "deezer" },
      }).success,
    ).toBe(false);
  });
});

const YTM_HOSTS = [
  "i.ytimg.com",
  "lh3.googleusercontent.com",
  "yt3.googleusercontent.com",
  "yt3.ggpht.com",
];
const thumb = (host: string) => `https://${host}/vi/dQw4w9WgXcQ/hq.jpg?sqp=x`;

describe("youtube-music artwork URLs", () => {
  test.each(YTM_HOSTS)("accepts %s and uses it as artwork", (host) => {
    const track = { ...ytm, artworkUrl: thumb(host) };
    expect(MusicTrackSchema.parse(track)).toEqual(track);
    expect(musicArtworkUrl(track, "guild")).toBe(thumb(host));
  });

  test.each([
    "https://i.scdn.co/image/ab67616d0000b273baf89eb11ec7c657805d2da0",
    "http://i.ytimg.com/vi/a/hq.jpg",
    "https://i.ytimg.com.example.org/vi/a/hq.jpg",
    "https://evil-i.ytimg.com/vi/a/hq.jpg",
    "https://user@i.ytimg.com/vi/a/hq.jpg",
    "https://i.ytimg.com:8443/vi/a/hq.jpg",
    "not a url",
  ])("rejects %s", (artworkUrl) => {
    expect(MusicTrackSchema.safeParse({ ...ytm, artworkUrl }).success).toBe(
      false,
    );
  });

  test("musicbrainz and spotify still reject YouTube hosts", () => {
    const artworkUrl = thumb("i.ytimg.com");
    expect(MusicTrackSchema.safeParse({ ...SONG, artworkUrl }).success).toBe(
      false,
    );
    expect(
      MusicTrackSchema.safeParse({
        provider: "spotify",
        id: "5nTtCOCds6I0PHMNtqelas",
        title: "Song",
        artists: ["Artist"],
        canonicalUrl: "https://open.spotify.com/track/5nTtCOCds6I0PHMNtqelas",
        artworkUrl,
      }).success,
    ).toBe(false);
  });
});

describe("persisted youtube-music tracks", () => {
  test("room checkpoint round-trips", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "streambot-ytm-room-"));
    dirs.push(dir);
    const music = musicSource({ ...ytm, artworkUrl: thumb("yt3.ggpht.com") });
    const requesterId = UserIdSchema.parse("100000000000000099");
    const state: PersistedState = {
      version: 2,
      guildId,
      channelId,
      statusChannelId: channelId,
      savedAt: Date.now(),
      loop: "off",
      volume: 100,
      current: {
        source: music,
        requesterId,
        title: ytm.title,
        positionSeconds: 5,
      },
      queue: [{ source: music, requesterId }],
      resumeAttempts: 0,
      resumeKey: null,
    };
    await new RoomPersistence(dir).update(
      PlaybackChannelNumberSchema.parse(1),
      "audio",
      state,
    );
    const saved = await loadRoomState(
      stateFilePath(dir, guildId, channelId),
      3600,
    );
    expect(saved?.slots[0]?.state.current?.source).toEqual(music);
    expect(saved?.slots[0]?.state.queue[0]?.source).toEqual(music);
  });

  test("history row round-trips", () => {
    history = new MediaHistoryStore(":memory:");
    const scope = { guildId: "one", channelId: "voice", userId: "me" };
    history.recordPlaybackStart({
      scope,
      media: {
        title: ytm.title,
        provider: "youtube",
        source: musicSource(ytm, "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      },
      nowMs: 1000,
    });
    const page = history.browseRuns({
      ...scope,
      visibility: "mine",
      query: "",
      provider: "",
      offset: 0,
    });
    expect(page.items[0]?.source.music).toEqual(ytm);
  });

  test("saved playlist entry round-trips", () => {
    history = new MediaHistoryStore(":memory:");
    const withArt = { ...ytm, artworkUrl: thumb("lh3.googleusercontent.com") };
    const created = history.playlists.create(owner, "Mixed", [
      { title: ytm.title, source: musicSource(withArt) },
      { title: SONG.title, source: musicSource(SONG) },
    ]);
    const read = history.playlists.read(created.id, owner);
    expect(read.items.map((item) => item.source.music)).toEqual([
      withArt,
      SONG,
    ]);
  });
});
