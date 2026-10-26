import { afterEach, describe, expect, test } from "vitest";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { rankMusicMatches } from "@shepherdjerred/streambot/music/matching.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { QueueLoads } from "@shepherdjerred/streambot/music/queue-loads.ts";
import {
  spotifyLink,
  SpotifyMetadata,
} from "@shepherdjerred/streambot/music/spotify.ts";
import {
  SourceSchema,
  sourceIdentity,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { MusicTrack } from "@shepherdjerred/streambot/music/contracts.ts";

const track: MusicTrack = {
  provider: "musicbrainz",
  id: "f4fe3e25-dfc1-4c2a-a954-872a6d0d7416",
  title: "Get Lucky",
  artists: ["Daft Punk"],
  durationSeconds: 369,
  canonicalUrl:
    "https://musicbrainz.org/recording/f4fe3e25-dfc1-4c2a-a954-872a6d0d7416",
};
const owner = { userId: "owner", guildId: "guild" };
const member = { userId: "member", guildId: "guild" };
const outsider = { userId: "outsider", guildId: "other" };
let history: MediaHistoryStore | undefined;
afterEach(() => {
  history?.close();
  history = undefined;
});

describe("native playlists", () => {
  test("saved sources drop scheduled playback ownership", () => {
    history = new MediaHistoryStore(":memory:");
    const playlist = history.playlists.create(owner, "Scheduled", [
      {
        title: "Scheduled stream",
        source: SourceSchema.parse({
          kind: "url",
          url: "https://example.com/live",
          mode: "video",
          spoken: false,
          scheduleId: "f4fe3e25-dfc1-4c2a-a954-872a6d0d7416",
        }),
      },
    ]);

    expect(playlist.items[0]?.source.kind).toBe("url");
    if (playlist.items[0]?.source.kind === "url") {
      expect(playlist.items[0].source.scheduleId).toBeUndefined();
      expect(playlist.items[0].source.mode).toBeUndefined();
      expect(playlist.items[0].source.spoken).toBeUndefined();
    }
  });

  test("private by default; public access follows server and owner-only edits", () => {
    history = new MediaHistoryStore(":memory:");
    const store = history.playlists;
    const created = store.create(owner, "Evening", [
      { title: track.title, source: musicSource(track) },
    ]);
    expect(created.guild_id).toBeNull();
    expect(() => store.read(created.id, member)).toThrow("unavailable");
    const published = store.edit(
      created.id,
      owner,
      created.revision,
      (item) => {
        item.guild_id = owner.guildId;
      },
    );
    expect(store.read(created.id, member).items[0]?.title).toBe(track.title);
    expect(() => store.read(created.id, outsider)).toThrow("unavailable");
    expect(() =>
      store.edit(created.id, member, published.revision, (item) => {
        item.name = "Hijacked";
      }),
    ).toThrow("Only the owner");
    const copy = store.create(
      member,
      "My copy",
      store.read(created.id, member).items,
    );
    expect(copy.user_id).toBe(member.userId);
    expect(copy.guild_id).toBeNull();
    store.edit(created.id, owner, published.revision, (item) => {
      item.guild_id = null;
    });
    expect(() => store.read(created.id, member)).toThrow("unavailable");
    expect(store.read(copy.id, member).items).toHaveLength(1);
  });
  test("edits preserve duplicates/order; stale edits and name collisions fail", () => {
    history = new MediaHistoryStore(":memory:");
    const store = history.playlists;
    const content = [
      { title: "A", source: musicSource(track) },
      { title: "B", source: musicSource(track) },
      { title: "A", source: musicSource(track) },
    ];
    const original = store.create(owner, "First", content);
    store.create(owner, "Other");
    expect(() => store.create(owner, "First")).toThrow("already have");
    const reordered = store.edit(original.id, owner, 0, (item) => {
      item.items.reverse();
      item.items.splice(0, 1);
    });
    expect(reordered.items.map((item) => item.title)).toEqual(["B", "A"]);
    expect(() =>
      store.edit(original.id, owner, 0, (item) => {
        item.name = "Stale";
      }),
    ).toThrow("changed");
    expect(() =>
      store.edit(original.id, owner, reordered.revision, (item) => {
        item.name = "Other";
      }),
    ).toThrow("already have");
    expect(store.read(original.id, owner).name).toBe("First");
    expect(history.savedQueueNames(owner.userId)).toEqual(["First", "Other"]);
  });
  test("legacy saved-queue methods address the same playlist service", () => {
    history = new MediaHistoryStore(":memory:");
    history.saveQueue(owner.userId, "Old command", [
      { title: track.title, provider: "youtube", source: musicSource(track) },
    ]);
    const playlist = history.playlists.list(owner, "mine")[0];
    expect(playlist?.name).toBe("Old command");
    expect(
      history.savedQueue(owner.userId, "Old command")[0]?.source.music,
    ).toEqual(track);
    history.deleteSavedQueue(owner.userId, "Old command");
    expect(history.playlists.list(owner, "mine")).toEqual([]);
  });
});

test("matching rejects other recordings and ranks the artist's album audio", () => {
  const results = rankMusicMatches(track, [
    {
      title: "Daft Punk - Get Lucky (Official Audio)",
      url: "https://www.youtube.com/watch?v=eeeeeeeeeee",
      channel: "An unrelated uploader",
      durationSeconds: 369,
    },
    {
      title: "Daft Punk - Get Lucky (Live)",
      url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      channel: "Daft Punk",
      durationSeconds: 369,
    },
    {
      title: "Get Lucky",
      url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
      channel: "A cover band",
      durationSeconds: 369,
    },
    {
      title: "Get Lucky",
      url: "https://www.youtube.com/watch?v=ccccccccccc",
      channel: "Daft Punk - Topic",
      durationSeconds: 369,
    },
    {
      title: "Daft Punk - Get Lucky",
      url: "https://www.youtube.com/watch?v=ddddddddddd",
      channel: "Daft Punk",
      durationSeconds: 240,
    },
  ]);
  expect(results[0]?.url).toContain("ccccccccccc");
  expect(
    results.filter((item) => item.confident).map((item) => item.url),
  ).toEqual([
    "https://www.youtube.com/watch?v=ccccccccccc",
    "https://www.youtube.com/watch?v=eeeeeeeeeee",
  ]);
});
test("catalog identity and selected video survive source serialization", () => {
  const requested = musicSource(
    track,
    "https://www.youtube.com/watch?v=ccccccccccc",
  );
  const serialized = JSON.stringify(requested);
  const restored = SourceSchema.parse(JSON.parse(serialized));
  expect(restored).toEqual(requested);
  expect(sourceIdentity(restored)).toBe(sourceIdentity(musicSource(track)));
});
test("Spotify accepts canonical public content links only", () => {
  expect(
    spotifyLink("https://open.spotify.com/intl-en/playlist/abc123?si=tracking"),
  ).toBe("https://open.spotify.com/playlist/abc123");
  expect(
    spotifyLink("https://open.spotify.com.evil.test/track/abc"),
  ).toBeNull();
  expect(
    spotifyLink("https://user:pass@open.spotify.com/track/abc"),
  ).toBeNull();
  expect(spotifyLink("https://open.spotify.com/episode/abc")).toBeNull();
});
test("Spotify extraction validates public metadata and explicitly reports playlist completeness", async () => {
  const entity = {
    type: "playlist",
    name: "Public playlist",
    uri: "spotify:playlist:37i9dQZEVXbMDoHDwVN2t",
    coverArt: {
      sources: [{ url: "https://i.scdn.co/image/test", width: 300 }],
    },
    trackList: [
      {
        uri: "spotify:track:5nTtCOCds6I0PHMNtqelas",
        title: "Get Lucky",
        subtitle: "Daft Punk",
        duration: 369_000,
      },
    ],
  };
  const html =
    '<html><body><script id="__NEXT_DATA__">' +
    JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) +
    "</script></body></html>";
  const provider = new SpotifyMetadata(
    Object.assign(() => Promise.resolve(new Response(html)), {
      preconnect: fetch.preconnect,
    }),
  );
  const result = await provider.load(
    "https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2t",
    AbortSignal.timeout(1000),
  );
  expect(result.complete).toBeNull();
  expect(result.tracks[0]?.durationSeconds).toBe(369);
  expect(result.warning).toContain("incomplete");
});
test("cancelled or stopped loads cannot commit late metadata", async () => {
  const loads = new QueueLoads();
  const pending = Promise.withResolvers<undefined>();
  let committed = false;
  const job = loads.start(
    { userId: "owner", guildId: "guild", channelId: "room", slot: 1 },
    async (signal) => {
      await pending.promise;
      signal.throwIfAborted();
      committed = true;
      return { count: 1, complete: true, message: "Done" };
    },
  );
  expect(() => loads.read(job.id, "member", "guild")).toThrow("expired");
  loads.cancelRoom("guild", "room", 1);
  pending.resolve(undefined);
  await Promise.resolve();
  await Promise.resolve();
  expect(committed).toBe(false);
  expect(loads.read(job.id, "owner", "guild").state).toBe("cancelled");
  loads.close();
});
