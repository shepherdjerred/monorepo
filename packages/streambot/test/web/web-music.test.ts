import type { z } from "zod";
import { afterEach, expect, test } from "vitest";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { PlaylistPageSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import {
  MusicAlbumSchema,
  MusicPageSchema,
  MusicMatchesSchema,
  MusicFeaturesSchema,
  QueueLoadSchema,
} from "@shepherdjerred/streambot/music/contracts.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import { waitFor } from "xstate";
import {
  CommandResultSchema,
  SnapshotSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { fixtureMusic, ALBUM, SONG } from "#music-fixture";
import { GUILD, CHANNEL, USER, OTHER, webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
let history: MediaHistoryStore | undefined;
afterEach(() => {
  fixture?.playback.deps.music?.loads.close();
  fixture?.close();
  history?.close();
  fixture = undefined;
  history = undefined;
});
function start() {
  history = new MediaHistoryStore(":memory:");
  const result = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    history,
    music: fixtureMusic(),
    musicEnabled: true,
    expandPlaylist: () =>
      Promise.resolve(
        Array.from({ length: 250 }, (_, index) => ({
          title: "Song " + String(index),
          url: "https://www.youtube.com/watch?v=h5EofwRzit0",
        })),
      ),
  });
  fixture = result;
  return result;
}
function get(path: string, f: ReturnType<typeof webFixture>) {
  return f.handler(
    new Request(
      "http://127.0.0.1:8080" +
        path +
        (path.includes("?") ? "&" : "?") +
        "guildId=" +
        GUILD,
      { headers: { cookie: f.cookie } },
    ),
  );
}
function mutate(f: ReturnType<typeof webFixture>, payload: object) {
  const request = f.command({ action: "volume", percent: 100 });
  return f.handler(
    new Request("http://127.0.0.1:8080/api/playlists", {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ ...payload, guildId: GUILD }),
    }),
  );
}

async function json<T>(
  response: Promise<Response>,
  schema: z.ZodType<T>,
): Promise<T> {
  const result = await response;
  return schema.parse(await result.json());
}

test("catalog and album browsing work without allocating a streaming account", async () => {
  const f = start();
  const page = await json(
    get("/api/music/catalog?query=Daft+Punk", f),
    MusicPageSchema,
  );
  expect(page.items[0]?.kind).toBe("artist");
  const album = await json(
    get("/api/music/album?album=" + ALBUM, f),
    MusicAlbumSchema,
  );
  expect(album.tracks.map((item) => item.title)).toEqual([
    "Get Lucky",
    "Instant Crush",
  ]);
  expect(album.selectionId).toBeDefined();
  expect(f.allocations()).toBe(0);
  f.setMember(false);
  const denied = await get("/api/music/catalog?query=Daft", f);
  expect(denied.status).toBe(403);
});

test("playlist API is CSRF protected and never exposes source paths", async () => {
  const f = start();
  const denied = await f.handler(
    new Request("http://127.0.0.1:8080/api/playlists", {
      method: "POST",
      headers: { cookie: f.cookie, origin: "http://127.0.0.1:8080" },
      body: JSON.stringify({
        action: "create",
        guildId: GUILD,
        name: "Denied",
      }),
    }),
  );
  expect(denied.status).toBe(403);
  const created = await json(
    mutate(f, { action: "create", name: "Evening" }),
    PlaylistPageSchema,
  );
  expect(created.guildId).toBeNull();
  const album = await json(
    get("/api/music/album?album=" + ALBUM, f),
    MusicAlbumSchema,
  );
  const added = await mutate(f, {
    action: "add",
    id: created.id,
    revision: 0,
    selectionId: album.selectionId,
  });
  const text = await added.text();
  expect(text).not.toContain("source_json");
  expect(text).not.toContain('"source":');
  const playlist = PlaylistPageSchema.parse(JSON.parse(text));
  expect(playlist.items).toHaveLength(2);
  const stale = await mutate(f, {
    action: "rename",
    id: playlist.id,
    revision: 0,
    name: "Stale",
  });
  expect(stale.status).toBe(409);
  const shared = await json(
    mutate(f, {
      action: "publish",
      id: playlist.id,
      revision: playlist.revision,
    }),
    PlaylistPageSchema,
  );
  expect(shared.guildId).toBe(GUILD);
});

test("external playlists add more than 100 tracks without saving a playlist", async () => {
  const f = start();
  const response = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: {
        kind: "url",
        url: "https://www.youtube.com/playlist?list=PLfixture",
      },
    }),
  );
  expect(response.status).toBe(200);
  const result = CommandResultSchema.parse(await response.json());
  const loadId = String(result.loadId);
  let load = await json(
    get("/api/music/load?id=" + loadId, f),
    QueueLoadSchema,
  );
  for (
    let attempt = 0;
    attempt < 20 && load.state === "loading";
    attempt += 1
  ) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    load = await json(get("/api/music/load?id=" + loadId, f), QueueLoadSchema);
  }
  expect(load.state).toBe("ready");
  expect(load.count).toBe(250);
  const snapshot = await json(get("/api/player", f), SnapshotSchema);
  expect(snapshot.queue.length + Number(snapshot.current !== null)).toBe(250);
  expect(
    history?.playlists.list(
      { userId: "100000000000000001", guildId: GUILD },
      "mine",
    ),
  ).toEqual([]);
});

test("making a shared playlist private revokes already-issued song tokens", async () => {
  const f = start();
  if (history === undefined) throw new Error("Missing history fixture");
  const owner = { userId: OTHER, guildId: GUILD };
  const original = history.playlists.create(owner, "Shared", [
    { title: SONG.title, source: musicSource(SONG) },
  ]);
  const published = history.playlists.edit(
    original.id,
    owner,
    original.revision,
    (p) => {
      p.guild_id = GUILD;
    },
  );
  const page = await json(
    get("/api/playlists?id=" + published.id, f),
    PlaylistPageSchema,
  );
  history.playlists.edit(published.id, owner, published.revision, (p) => {
    p.guild_id = null;
  });
  const denied = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: { kind: "music", id: page.items[0]?.selectionId },
    }),
  );
  expect(denied.status).toBe(404);
  expect(f.allocations()).toBe(0);
});

test("large saved playlists paginate without expiring the first visible selection", async () => {
  const f = start();
  if (history === undefined) throw new Error("Missing history fixture");
  const playlist = history.playlists.create(
    { userId: USER, guildId: GUILD },
    "Large",
    Array.from({ length: 250 }, (_, i) => ({
      title: String(i),
      source: musicSource(SONG),
    })),
  );
  const page = await json(
    get("/api/playlists?id=" + playlist.id + "&offset=200", f),
    PlaylistPageSchema,
  );
  expect(page.count).toBe(250);
  expect(page.items).toHaveLength(50);
  expect(page.items[0]?.title).toBe("200");
  const queued = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: { kind: "music", id: page.items[0]?.selectionId },
    }),
  );
  expect(queued.status).toBe(200);
});

function queueMatch(
  f: ReturnType<typeof webFixture>,
  playback: unknown,
  selectionId?: string,
) {
  return f.handler(
    new Request(
      "http://127.0.0.1:8080/api/music/queue-match?guildId=" + GUILD,
      {
        method: "POST",
        headers: f.command({}).headers,
        body: JSON.stringify({ playback, position: 1, selectionId }),
      },
    ),
  );
}
test.each([undefined, 1, 2])(
  "recording correction preserves transport on slot %s and rejects stale queue choices",
  async (slot) => {
    const f = start();
    if (slot !== undefined) f.enableNumbered(slot);
    await f.seed();
    const album = await json(
      get("/api/music/album?album=" + ALBUM, f),
      MusicAlbumSchema,
    );
    await f.handler(
      f.command({
        action: "play",
        placement: "queue",
        selection: { kind: "music", id: album.selectionId },
      }),
    );
    const playback: unknown = await f
      .command({ action: "volume", percent: 100 })
      .json();
    const matches = await json(queueMatch(f, playback), MusicMatchesSchema);
    expect(matches[0]?.confident).toBe(true);
    const selected = await queueMatch(f, playback, matches[0]?.selectionId);
    expect(selected.status).toBe(200);
    expect(f.actor.getSnapshot().context.queue[0]?.source.kind).toBe("url");
    expect(f.actor.getSnapshot().context.queue[0]?.source.mode).toBe(
      slot === 2 ? "video" : "music",
    );
    expect(
      f.actor.getSnapshot().context.queue[0]?.source.music?.artworkId,
    ).toBe(ALBUM);
    const stale = await queueMatch(f, playback, matches[0]?.selectionId);
    expect(stale.status).toBe(409);
  },
);

test("playlist cover metadata survives save, copy, pagination, and queue presentation", async () => {
  const f = start();
  if (history === undefined) throw new Error("Missing history fixture");
  const original = history.playlists.create(
    { userId: USER, guildId: GUILD },
    "Artwork",
    Array.from({ length: 60 }, () => ({
      title: SONG.title,
      source: musicSource(SONG),
    })),
  );
  const page = await json(
    get("/api/playlists?id=" + original.id + "&offset=50", f),
    PlaylistPageSchema,
  );
  expect(page.cover?.artworkId).toBe(ALBUM);
  expect(page.items[0]?.music?.artworkId).toBe(ALBUM);
  expect(
    history.playlists.list({ userId: USER, guildId: GUILD }, "mine")[0]?.cover
      ?.artworkId,
  ).toBe(ALBUM);
  const copy = await json(
    mutate(f, { action: "copy", id: original.id }),
    PlaylistPageSchema,
  );
  expect(copy.cover).toEqual(page.cover);
  await f.seed();
  await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: { kind: "music", id: page.items[0]?.selectionId },
    }),
  );
  const snapshot = await json(get("/api/player", f), SnapshotSchema);
  expect(snapshot.queue[0]?.artworkUrl).toBe(musicArtworkUrl(SONG, GUILD));
});

test("play-now album order survives a pending voice join", async () => {
  const pending = Promise.withResolvers<{
    guildId: typeof GUILD;
    channelId: typeof CHANNEL;
  }>();
  history = new MediaHistoryStore(":memory:");
  const f = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    history,
    music: fixtureMusic(),
    musicEnabled: true,
    join: () => pending.promise,
  });
  fixture = f;
  await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: {
        kind: "url",
        url: "https://www.youtube.com/watch?v=h5EofwRzit0",
      },
    }),
  );
  expect(f.actor.getSnapshot().value).toBe("joining");
  const album = await json(
    get("/api/music/album?album=" + ALBUM, f),
    MusicAlbumSchema,
  );
  const queued = await f.handler(
    f.command({
      action: "play",
      placement: "now",
      selection: { kind: "music", id: album.selectionId },
    }),
  );
  expect(queued.status).toBe(200);
  expect(
    f.actor.getSnapshot().context.queue.map((item) => item.source.music?.title),
  ).toEqual(["Get Lucky", "Instant Crush", undefined]);
  pending.resolve({ guildId: GUILD, channelId: CHANNEL });
  await waitFor(f.actor, (snapshot) => snapshot.matches("streaming"), {
    timeout: 2000,
  });
  expect(f.actor.getSnapshot().context.current?.source.music?.title).toBe(
    "Get Lucky",
  );
});

test("saved recording corrections persist and reject a stale playlist token", async () => {
  const f = start();
  if (history === undefined) throw new Error("Missing history fixture");
  const created = history.playlists.create(
    { userId: USER, guildId: GUILD },
    "Recordings",
    [{ title: SONG.title, source: musicSource(SONG) }],
  );
  const page = await json(
    get("/api/playlists?id=" + created.id, f),
    PlaylistPageSchema,
  );
  const matches = await json(
    get(
      "/api/music/matches?selectionId=" + String(page.items[0]?.selectionId),
      f,
    ),
    MusicMatchesSchema,
  );
  const updated = await json(
    mutate(f, {
      action: "match",
      id: page.id,
      revision: page.revision,
      itemId: page.items[0]?.id,
      selectionId: matches[0]?.selectionId,
    }),
    PlaylistPageSchema,
  );
  expect(updated.revision).toBe(1);
  expect(updated.items[0]?.matched).toBe(true);
  expect(
    history.playlists.read(created.id, { userId: USER, guildId: GUILD })
      .items[0]?.source.kind,
  ).toBe("url");
  const expired = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: { kind: "music", id: matches[0]?.selectionId },
    }),
  );
  expect(expired.status).toBe(409);
});

test("default-off music gates reject discovery, playlists, and Spotify before allocation", async () => {
  const f = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    music: fixtureMusic(),
  });
  fixture = f;
  const features = await json(
    get("/api/music/features", f),
    MusicFeaturesSchema,
  );
  expect(features).toEqual({
    catalog: false,
    spotify: false,
    playlists: false,
  });
  const catalog = await get("/api/music/catalog?query=Daft", f);
  const playlists = await get("/api/playlists", f);
  const spotify = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: {
        kind: "url",
        url: "https://open.spotify.com/track/5nTtCOCds6I0PHMNtqelas",
      },
    }),
  );
  expect([catalog.status, playlists.status, spotify.status]).toEqual([
    403, 403, 403,
  ]);
  expect(f.allocations()).toBe(0);
});
