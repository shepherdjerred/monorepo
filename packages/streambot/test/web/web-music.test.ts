import type { z } from "zod";
import { afterEach, expect, test } from "vitest";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { PlaylistPageSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { MusicMatchesSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import { waitFor } from "xstate";
import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { BrowsePageSchema } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { fixtureMusic, ALBUM, SONG } from "#music-fixture";
import { albumSelection, recordLoads } from "./web-fixture-music.ts";
import { GUILD, CHANNEL, USER, OTHER, webFixture } from "./web-fixture.ts";
import { roomPlayer } from "./web-fixture-login.ts";

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

test("album browsing works without allocating a streaming account", async () => {
  const f = start();
  f.setSearchProvider("musicbrainz");
  const album = await json(
    get("/api/music/v2/album?id=" + ALBUM, f),
    BrowsePageSchema,
  );
  expect(album.rows.map((row) => row.title)).toEqual([
    "Get Lucky",
    "Instant Crush",
  ]);
  expect(album.play?.id).toBeDefined();
  expect(f.allocations()).toBe(0);
  f.setMember(false);
  const denied = await get("/api/music/v2/album?id=" + ALBUM, f);
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
  const added = await mutate(f, {
    action: "add",
    id: created.id,
    revision: 0,
    selectionId: await albumSelection(f, { album: ALBUM, guildId: GUILD }),
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
  const loads = recordLoads(f.playback.deps.music);
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
  expect(CommandResultSchema.parse(await response.json()).message).toBeTruthy();
  const read = () =>
    f.playback.deps.music?.loads.read(String(loads[0]), USER, GUILD);
  let load = read();
  for (
    let attempt = 0;
    attempt < 20 && load?.state === "loading";
    attempt += 1
  ) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    load = read();
  }
  expect(load?.state).toBe("ready");
  expect(load?.count).toBe(250);
  const player = await roomPlayer(f);
  if (player === undefined) throw new Error("Expected a player");
  expect(player.queue.length + Number(player.current !== null)).toBe(250);
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
  const player = await roomPlayer(f);
  expect(player?.queue[0]?.artworkUrl).toBe(musicArtworkUrl(SONG, GUILD));
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
  const queued = await f.handler(
    f.command({
      action: "play",
      placement: "now",
      selection: {
        kind: "music",
        id: await albumSelection(f, { album: ALBUM, guildId: GUILD }),
      },
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
  const { capabilities } = await f.room();
  expect(capabilities).toMatchObject({
    musicCatalog: false,
    spotifyLinks: false,
    playlists: false,
  });
  const catalog = await get("/api/search/v2?kind=songs&q=Daft", f);
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
