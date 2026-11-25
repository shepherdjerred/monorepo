import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { musicProviderDroppedItemsTotal } from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { createMusicSearchProviders } from "@shepherdjerred/streambot/music/search-instrumentation.ts";
import {
  DEFAULT_MUSIC_SEARCH_PROVIDER,
  MusicSearchError,
  MusicSearchProviders,
  validateItems,
  type MusicSearchProvider,
} from "@shepherdjerred/streambot/music/search-provider.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { MusicTrackSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { SourceSchema } from "@shepherdjerred/streambot/sources/source.ts";
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
import { ALBUM_ID, replayProvider } from "./youtube-music-fixture.ts";

const scope = { guildId: "1", channelId: "2", userId: "3" };
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});

function named(name: "youtube-music" | "musicbrainz"): MusicSearchProvider {
  return {
    name,
    search: () => Promise.resolve({ items: [] }),
    suggestions: () => Promise.resolve({ kind: "unsupported" }),
    albumTracks: () => Promise.reject(new Error("unused")),
    artistTop: () => Promise.reject(new Error("unused")),
  };
}

const providers = (selected: string) =>
  createMusicSearchProviders(
    {
      "youtube-music": named("youtube-music"),
      musicbrainz: named("musicbrainz"),
    },
    () => Promise.resolve(selected),
  );

const parse = (item: unknown) => z.string().min(1).parse(item);

describe("provider selection", () => {
  test("each flag value selects its provider", async () => {
    const youtube = await providers("youtube-music").current(scope);
    const musicbrainz = await providers("musicbrainz").current(scope);
    expect(youtube.name).toBe("youtube-music");
    expect(musicbrainz.name).toBe("musicbrainz");
  });

  test("an unknown or empty value throws instead of falling back", async () => {
    for (const value of ["spotify", "YouTube Music", "", "youtube_music"])
      await expect(providers(value).current(scope)).rejects.toBeInstanceOf(
        z.ZodError,
      );
  });

  test("the flag is read for the viewer's scope on every call", async () => {
    const seen: string[] = [];
    const registry = new MusicSearchProviders(
      {
        "youtube-music": named("youtube-music"),
        musicbrainz: named("musicbrainz"),
      },
      (value) => {
        seen.push(value.userId);
        return Promise.resolve("musicbrainz");
      },
    );
    await registry.current(scope);
    await registry.current({ ...scope, userId: "4" });
    expect(seen).toEqual(["3", "4"]);
  });

  test("the code default is the declared Flags default for production and beta", () => {
    const flag = managedFlagInventory.flags.find(
      (candidate) => candidate.key === "streambot-music-search-provider",
    );
    expect(flag).toMatchObject({
      type: "variant",
      namespace: "streambot",
      default: DEFAULT_MUSIC_SEARCH_PROVIDER,
    });
    expect(DEFAULT_MUSIC_SEARCH_PROVIDER).toBe("youtube-music");
    for (const environment of managedFlagInventory.environments)
      expect(
        environment.overrides.some(
          (override) => override.key === "streambot-music-search-provider",
        ),
      ).toBe(false);
  });
});

describe("strict item validation", () => {
  beforeEach(() => {
    musicProviderDroppedItemsTotal.reset();
  });
  test("invalid items are dropped; valid ones survive", () => {
    expect(
      validateItems({
        provider: "youtube-music",
        operation: "search_song",
        raw: ["a", 1, "b", ""],
        parse,
      }),
    ).toEqual(["a", "b"]);
  });

  test("nothing validating is an error and an empty response is not", () => {
    expect(() =>
      validateItems({
        provider: "youtube-music",
        operation: "search_song",
        raw: [1, 2],
        parse,
      }),
    ).toThrow(MusicSearchError);
    expect(
      validateItems({
        provider: "youtube-music",
        operation: "search_song",
        raw: [],
        parse,
      }),
    ).toEqual([]);
  });
});

describe("a YouTube Music track is a playable source", () => {
  test("it is a URL source on its music.youtube.com watch page, with no search step", async () => {
    const page = await replayProvider().search(
      "song",
      "get lucky",
      new AbortController().signal,
    );
    const hit = page.items[0];
    if (hit?.kind !== "song") throw new Error("Expected a song hit");
    const source = musicSource(hit.track);
    expect(source).toMatchObject({
      kind: "url",
      url: "https://music.youtube.com/watch?v=4D7u5KF7SP8",
      mode: "music",
      music: { provider: "youtube-music", id: "4D7u5KF7SP8" },
    });
    // The persisted form survives a checkpoint round trip unchanged.
    const persisted = JSON.stringify(source);
    expect(SourceSchema.parse(JSON.parse(persisted))).toEqual(source);
    expect(MusicTrackSchema.parse(hit.track)).toEqual(hit.track);
    expect(ALBUM_ID).toMatch(/^MPREb_/u);
  });

  test("a queued track round-trips through the room checkpoint", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "streambot-ytm-search-"));
    dirs.push(dir);
    const page = await replayProvider().search(
      "song",
      "get lucky",
      new AbortController().signal,
    );
    const hit = page.items[0];
    if (hit?.kind !== "song") throw new Error("Expected a song hit");
    const queued = musicSource(hit.track);
    const guildId = GuildIdSchema.parse("100000000000000001");
    const channelId = ChannelIdSchema.parse("100000000000000010");
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
        source: queued,
        requesterId,
        title: "Get Lucky",
        positionSeconds: 3,
      },
      queue: [{ source: queued, requesterId }],
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
    expect(saved?.slots[0]?.state.queue[0]?.source).toEqual(queued);
    expect(saved?.slots[0]?.state.current?.source).toEqual(queued);
  });
});
