import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { z } from "zod";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import { MusicTrackSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { createMusicSearchProviders } from "@shepherdjerred/streambot/music/search-instrumentation.ts";
import { MusicBrainzProvider } from "@shepherdjerred/streambot/music/musicbrainz-provider.ts";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import {
  playRequestsTotal,
  webSearchDurationSeconds,
  webSearchTotal,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  HistoryPageSchema,
  RoomSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { getRequest } from "./web-room-harness.ts";
import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  BrowsePageSchema,
  SearchResponseSchema,
  SuggestResponseSchema,
  selectionForRow,
  type Row,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { fixtureMusic } from "#music-fixture";
import {
  ALBUM_ID,
  ARTIST_ID,
  replayProvider,
  responses,
  SONG_SEARCH,
} from "#youtube-music-fixture";
import { FIXTURE_EVENTS } from "./web-fixture-media.ts";
import { CHANNEL, GUILD, OTHER, USER, webFixture } from "./web-fixture.ts";

const ORIGIN = "http://127.0.0.1:8080";
let fixture: ReturnType<typeof webFixture> | undefined;
let history: MediaHistoryStore | undefined;

beforeEach(() => {
  webSearchTotal.reset();
  webSearchDurationSeconds.reset();
  playRequestsTotal.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fixture?.playback.deps.music?.loads.close();
  fixture?.close();
  history?.close();
  fixture = undefined;
  history = undefined;
});

type Options = Parameters<typeof webFixture>[3];
function start(options: Options = {}, withHistory = true) {
  history = withHistory ? new MediaHistoryStore(":memory:") : undefined;
  const result = webFixture(ORIGIN, "/nonexistent", false, {
    ...(history === undefined ? {} : { history }),
    music: fixtureMusic(),
    musicEnabled: true,
    ...options,
  });
  fixture = result;
  return result;
}

function request(
  path: string,
  f: ReturnType<typeof webFixture>,
  guild: string = GUILD,
) {
  const separator = path.includes("?") ? "&" : "?";
  const url = path.startsWith("/api/search/v2/suggest")
    ? path
    : path + separator + "guildId=" + guild;
  return f.handler(
    new Request(ORIGIN + url, { headers: { cookie: f.cookie } }),
  );
}

async function rows(
  f: ReturnType<typeof webFixture>,
  kind: string,
  q: string,
): Promise<z.infer<typeof SearchResponseSchema>> {
  const response = await request(
    "/api/search/v2?" + new URLSearchParams({ kind, q }).toString(),
    f,
  );
  expect(response.status).toBe(200);
  return SearchResponseSchema.parse(await response.json());
}

async function items(
  f: ReturnType<typeof webFixture>,
  kind: string,
  q: string,
): Promise<Row[]> {
  const result = await rows(f, kind, q);
  return result.items;
}

async function firstRow(
  f: ReturnType<typeof webFixture>,
  kind: string,
  q: string,
): Promise<Row | undefined> {
  const found = await items(f, kind, q);
  return found[0];
}

async function firstActions(
  f: ReturnType<typeof webFixture>,
  kind: string,
  q: string,
) {
  const row = await firstRow(f, kind, q);
  return row?.actions;
}

async function statusOf(
  path: string,
  f: ReturnType<typeof webFixture>,
  guild: string = GUILD,
): Promise<number> {
  const response = await request(path, f, guild);
  return response.status;
}

async function metricValues(name: string) {
  const metrics = await register.getMetricsAsJSON();
  return metrics.find((candidate) => candidate.name === name)?.values ?? [];
}

function onlyRow(rowsToSearch: readonly Row[], title: string): Row {
  const row = rowsToSearch.find((item) => item.title === title);
  if (row === undefined) throw new Error("Missing row " + title);
  return row;
}

async function play(
  f: ReturnType<typeof webFixture>,
  row: Pick<Row, "id" | "kind">,
  transport: "listen" | "watch",
) {
  const selection = selectionForRow(row);
  if (selection === null) throw new Error("Row cannot be played");
  return await f.handler(
    f.command({ action: "play", selection, placement: "queue", transport }),
  );
}

function record(
  media: { title: string; provider: "youtube" | "local"; source: Source },
  userId = USER,
) {
  if (history === undefined) throw new Error("History is not enabled");
  const scope = { guildId: GUILD, channelId: CHANNEL, userId };
  const requestId = history.recordQueueRequest({
    scope,
    media,
    rawQuery: media.title,
    intent: inferMediaIntent({ query: media.title }),
  });
  history.recordPlaybackStart({ scope, media, requestId });
}

test("songs are directly playable rows that offer Listen, with Watch in the menu", async () => {
  const f = start();
  const result = await rows(f, "songs", "get lucky");
  expect(result.kind).toBe("songs");
  expect(result.correctedQuery).toBeUndefined();
  const row = result.items[0];
  expect(row).toMatchObject({
    kind: "song",
    title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
    subtitle:
      "Daft Punk, Pharrell Williams, Nile Rodgers · Random Access Memories",
    durationSeconds: 370,
    actions: ["listen"],
    menuActions: ["watch"],
  });
  expect(row?.artworkUrl).toMatch(/^https:\/\/yt3\.googleusercontent\.com\//u);
  expect(new Set(result.items.map((item) => item.id)).size).toBe(
    result.items.length,
  );
});

test("a misspelled query reports what the provider searched instead", async () => {
  const f = start();
  const result = await rows(f, "songs", "bohemian rapsody");
  expect(result.correctedQuery).toBe("bohemian rhapsody");
  expect(result.items[0]?.title).toBe("Bohemian Rhapsody");
});

test("albums and artists are browse rows, not playable ones", async () => {
  const f = start();
  const albums = await rows(f, "albums", "daft punk");
  expect(albums.items[0]).toMatchObject({
    kind: "album",
    id: ALBUM_ID,
    title: "Random Access Memories",
    subtitle: "Daft Punk · 2013",
    actions: [],
    browse: { kind: "album", id: ALBUM_ID },
  });
  const artists = await rows(f, "artists", "daft punk");
  expect(artists.items[0]).toMatchObject({
    kind: "artist",
    title: "Daft Punk",
    actions: [],
    browse: { kind: "artist", id: ARTIST_ID },
  });
  expect(
    selectionForRow(albums.items[0] ?? { id: "x", kind: "album" }),
  ).toBeNull();
});

test("library files can only be watched", async () => {
  const f = start();
  const result = await rows(f, "library", "arrival");
  expect(onlyRow(result.items, "Arrival")).toMatchObject({
    kind: "library",
    subtitle: "movies · 2016",
    actions: ["watch"],
  });
  expect(await items(f, "library", "nothingmatchesthis")).toEqual([]);
});

test("YouTube videos name Watch first and Listen second", async () => {
  const f = start();
  const result = await rows(f, "videos", "khruangbin");
  expect(result.items[0]).toMatchObject({
    kind: "video",
    title: "khruangbin · live session",
    subtitle: "Tiny Desk",
    durationSeconds: 240,
    actions: ["watch", "listen"],
  });
});

test("live rows offer Watch only while the event can be played", async () => {
  const f = start();
  const result = await rows(f, "live", "");
  const live = onlyRow(result.items, "Seattle Seahawks vs San Francisco 49ers");
  expect(live).toMatchObject({
    kind: "live",
    status: "live",
    actions: ["watch"],
  });
  expect(live.sportsArtwork?.league?.name).toBe("NFL");
  const upcoming = onlyRow(
    result.items,
    "Los Angeles Lakers vs Golden State Warriors",
  );
  expect(upcoming).toMatchObject({
    status: "scheduled",
    startsAt: "2030-01-01T22:00:00.000Z",
    actions: [],
  });
  expect(FIXTURE_EVENTS.length).toBeGreaterThan(0);
});

function buttons(row: Pick<Row, "actions" | "menuActions"> | undefined) {
  return { actions: row?.actions, menuActions: row?.menuActions };
}

/** A track is a song, other YouTube media offers both, library media only plays as video. */
function expectedReplayButtons(listen: boolean) {
  return {
    Arrival: { actions: ["watch"], menuActions: undefined },
    "Khruangbin Tiny Desk": {
      actions: listen ? ["watch", "listen"] : ["watch"],
      menuActions: undefined,
    },
    "Daft Punk — Get Lucky": listen
      ? { actions: ["listen"], menuActions: ["watch"] }
      : { actions: ["watch"], menuActions: undefined },
  };
}

test("history rows follow how the item was recorded", async () => {
  const f = start();
  record({
    title: "Arrival",
    provider: "local",
    source: {
      kind: "file",
      path: "/media/movies/arrival.mkv",
      title: "Arrival",
    },
  });
  record({
    title: "Khruangbin Tiny Desk",
    provider: "youtube",
    source: { kind: "url", url: "https://www.youtube.com/watch?v=QrR_gm6RqCo" },
  });
  const track = MusicTrackSchema.parse({
    provider: "youtube-music",
    id: "4D7u5KF7SP8",
    title: "Get Lucky",
    artists: ["Daft Punk"],
    canonicalUrl: "https://music.youtube.com/watch?v=4D7u5KF7SP8",
  });
  record({
    title: "Daft Punk — Get Lucky",
    provider: "youtube",
    source: {
      kind: "url",
      url: track.canonicalUrl,
      mode: "music",
      music: track,
    },
  });
  for (const listen of [true, false]) {
    f.setMusicOverVoice(listen);
    const result = await rows(f, "history", "");
    const response = await request("/api/history", f);
    const page = HistoryPageSchema.parse(await response.json());
    for (const [title, want] of Object.entries(expectedReplayButtons(listen))) {
      // The search row and the `/api/history` item get their buttons from the same rule.
      expect(buttons(onlyRow(result.items, title)), title).toEqual(want);
      expect(
        buttons(page.items.find((item) => item.title === title)),
        title,
      ).toEqual(want);
    }
  }
  expect(await items(f, "history", "arrival")).toHaveLength(1);
});

test("a capability that is off removes its action or its group instead of failing the click", async () => {
  const f = start();
  f.setMusicOverVoice(false);
  // A song without Listen is still playable: Watch becomes its button and the menu is empty.
  const song = await firstRow(f, "songs", "get lucky");
  expect(song?.actions).toEqual(["watch"]);
  expect(song).not.toHaveProperty("menuActions");
  expect(await firstActions(f, "videos", "khruangbin")).toEqual(["watch"]);
  f.setSportsEnabled(false);
  const live = await request("/api/search/v2?kind=live&q=", f);
  expect(live.status).toBe(403);
  expect(await live.json()).toMatchObject({ code: "sports_disabled" });
  const noHistory = start({}, false);
  const denied = await request("/api/search/v2?kind=history&q=", noHistory);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "history_disabled" });
  const noMusic = start({ musicEnabled: false });
  const music = await request("/api/search/v2?kind=songs&q=get+lucky", noMusic);
  expect(music.status).toBe(403);
  expect(await music.json()).toMatchObject({ code: "feature_disabled" });
});

test("a pasted link is one row with both buttons and other groups return nothing for it", async () => {
  const f = start();
  const link = "https://www.youtube.com/watch?v=QrR_gm6RqCo";
  const result = await rows(f, "videos", link);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    id: link,
    kind: "link",
    title: "www.youtube.com/watch",
    actions: ["watch", "listen"],
  });
  expect(selectionForRow(result.items[0] ?? { id: "x", kind: "link" })).toEqual(
    {
      kind: "url",
      url: link,
    },
  );
  for (const kind of [
    "songs",
    "albums",
    "artists",
    "library",
    "live",
    "history",
  ])
    expect(await items(f, kind, link)).toEqual([]);
  expect(await items(f, "videos", "https://")).toEqual([]);
  f.setMusicOverVoice(false);
  expect(await firstActions(f, "videos", link)).toEqual(["watch"]);
});

test("a pasted link plays through the existing link path in either transport", async () => {
  const f = start();
  for (const transport of ["listen", "watch"] as const) {
    const response = await play(
      f,
      { id: "https://www.youtube.com/watch?v=QrR_gm6RqCo", kind: "link" },
      transport,
    );
    expect(response.status).toBe(200);
  }
});

test("selection tokens are bound to the viewer and expire", async () => {
  const f = start();
  const row = await firstRow(f, "songs", "get lucky");
  if (row === undefined) throw new Error("Expected a row");
  const stranger = f.store.create({
    userId: OTHER,
    username: "stranger",
    guildIds: [GUILD],
  });
  const selection = selectionForRow(row);
  const foreign = await f.handler(
    new Request(ORIGIN + "/api/commands", {
      method: "POST",
      headers: {
        cookie: "streambot_session=" + stranger.token,
        origin: ORIGIN,
        "x-csrf-token": stranger.csrfToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        guildId: GUILD,
        channelId: CHANNEL,
        revision: null,
        playbackChannel: null,
        action: "play",
        selection,
        placement: "queue",
        transport: "listen",
      }),
    }),
  );
  expect(foreign.status).toBe(409);
  expect(await foreign.json()).toMatchObject({ code: "selection_expired" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 11 * 60_000);
  const expired = await play(f, row, "listen");
  expect(expired.status).toBe(409);
  expect(await expired.json()).toMatchObject({ code: "selection_expired" });
});

/** One selected song played in one transport; returns what reached the resolver. */
async function playSong(transport: "listen" | "watch") {
  const resolved: Source[] = [];
  const searched = vi.fn();
  const base = fixtureMusic();
  const music = new MusicService(base.catalog, base.spotify, (query) => {
    searched(query);
    return Promise.resolve([]);
  });
  const f = start({
    music,
    resolve: (source) => {
      resolved.push(source);
      return {
        title: "Get Lucky",
        chapters: [],
        ffmpegInput: "fixture",
        mediaKind: source.mode === "music" ? "music" : "video",
        durationSeconds: 370,
      };
    },
  });
  const row = await firstRow(f, "songs", "get lucky");
  if (row === undefined) throw new Error("Expected a row");
  const response = await play(f, row, transport);
  expect(response.status).toBe(200);
  const result = CommandResultSchema.parse(await response.json());
  await vi.waitFor(() => expect(resolved.length).toBeGreaterThan(0));
  expect(searched).not.toHaveBeenCalled();
  return { resolved, result };
}

test("a selected song plays as Listen straight from its YouTube Music page", async () => {
  const { resolved, result } = await playSong("listen");
  expect(result.destination).toEqual({
    transport: "listen",
    voiceChannelName: "Movie night",
  });
  expect(resolved).toHaveLength(1);
  expect(resolved[0]).toMatchObject({
    kind: "url",
    url: "https://music.youtube.com/watch?v=4D7u5KF7SP8",
    mode: "music",
    music: { provider: "youtube-music", id: "4D7u5KF7SP8" },
  });
});

test("a selected song plays as Watch from the same page, with no YouTube search step", async () => {
  const { resolved } = await playSong("watch");
  expect(resolved[0]).toMatchObject({
    kind: "url",
    url: "https://music.youtube.com/watch?v=4D7u5KF7SP8",
    mode: "video",
  });
  expect(resolved.some((source) => source.kind === "search")).toBe(false);
});

test("an album page lists its tracks and plays whole as one request", async () => {
  const f = start();
  const response = await request(
    "/api/music/v2/album?" + new URLSearchParams({ id: ALBUM_ID }).toString(),
    f,
  );
  expect(response.status).toBe(200);
  const page = BrowsePageSchema.parse(await response.json());
  expect(page.header).toMatchObject({
    kind: "album",
    id: ALBUM_ID,
    title: "Random Access Memories",
    subtitle: "Daft Punk · 2013",
  });
  expect(page.rows.map((row) => row.title)).toEqual([
    "Give Life Back to Music",
    "The Game of Love",
    "Giorgio by Moroder",
  ]);
  for (const row of page.rows) {
    expect(row.actions).toEqual(["listen"]);
    expect(row.menuActions).toEqual(["watch"]);
  }
  expect(page.play?.actions).toEqual(["listen"]);
  expect(page.play?.menuActions).toEqual(["watch"]);
  if (page.play === undefined)
    throw new Error("Expected a whole-album selection");
  f.setMusicOverVoice(false);
  const withoutListen = await request(
    "/api/music/v2/album?" + new URLSearchParams({ id: ALBUM_ID }).toString(),
    f,
  );
  const watchOnly = BrowsePageSchema.parse(await withoutListen.json()).play;
  expect(watchOnly?.actions).toEqual(["watch"]);
  expect(watchOnly).not.toHaveProperty("menuActions");
  f.setMusicOverVoice(true);
  const played = await f.handler(
    f.command({
      action: "play",
      selection: { kind: "music", id: page.play.id },
      placement: "queue",
      transport: "listen",
    }),
  );
  expect(played.status).toBe(200);
  const queued = f.actor.getSnapshot().context;
  expect((queued.current === null ? 0 : 1) + queued.queue.length).toBe(3);
  const plays = await metricValues("streambot_play_requests_total");
  expect(plays.reduce((total, value) => total + value.value, 0)).toBe(1);
});

test("an artist page lists top songs then albums", async () => {
  const f = start();
  const response = await request(
    "/api/music/v2/artist?" + new URLSearchParams({ id: ARTIST_ID }).toString(),
    f,
  );
  expect(response.status).toBe(200);
  const page = BrowsePageSchema.parse(await response.json());
  expect(page.header).toMatchObject({ kind: "artist", title: "Daft Punk" });
  const kinds = page.rows.map((row) => row.kind);
  expect(kinds.slice(0, 3)).toEqual(["song", "song", "song"]);
  expect(kinds).toContain("album");
  expect(
    page.rows.find((row) => row.kind === "song")?.durationSeconds,
  ).toBeUndefined();
  const stale = await request("/api/music/v2/artist?id=not-a-provider-id", f);
  expect(stale.status).toBe(404);
  expect(await stale.json()).toMatchObject({ code: "not_found" });
});

test("suggestions come from the provider, are capped, and are empty where unsupported", async () => {
  const f = start();
  const response = await request("/api/search/v2/suggest?q=get+lu", f);
  expect(response.status).toBe(200);
  const body = SuggestResponseSchema.parse(await response.json());
  expect(body.suggestions).toContain("get lucky");
  expect(body.suggestions.length).toBeLessThanOrEqual(8);
  f.setSearchProvider("musicbrainz");
  const unsupported = await request("/api/search/v2/suggest?q=get+lu", f);
  expect(
    SuggestResponseSchema.parse(await unsupported.json()).suggestions,
  ).toEqual([]);
  f.setSearchProvider("youtube-music");
  const link = await request(
    "/api/search/v2/suggest?q=" + encodeURIComponent("https://example.com/x"),
    f,
  );
  expect(SuggestResponseSchema.parse(await link.json()).suggestions).toEqual(
    [],
  );
});

test("MusicBrainz can still answer music search when it is the selected provider", async () => {
  const f = start();
  f.setSearchProvider("musicbrainz");
  const songs = await rows(f, "songs", "daft punk");
  expect(songs.items[0]).toMatchObject({
    kind: "song",
    title: "Get Lucky",
    actions: ["listen"],
    menuActions: ["watch"],
  });
  expect(songs.items[0]?.artworkUrl).toContain("/api/music/artwork?");
});

test("an unknown provider value fails loudly instead of choosing one", async () => {
  const f = start();
  f.setSearchProvider("spotify");
  const response = await request("/api/search/v2?kind=songs&q=get+lucky", f);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "unavailable" });
});

test("one group failing leaves the others working and is counted", async () => {
  const broken = Object.fromEntries(
    Object.entries(responses()).filter(([key]) => key !== SONG_SEARCH),
  );
  const f = start();
  f.playback.deps.musicSearch = createMusicSearchProviders(
    {
      "youtube-music": replayProvider(broken),
      musicbrainz: new MusicBrainzProvider(fixtureMusic().catalog),
    },
    () => Promise.resolve("youtube-music"),
  );
  const [songs, library, albums] = await Promise.all([
    request("/api/search/v2?kind=songs&q=get+lucky", f),
    request("/api/search/v2?kind=library&q=arrival", f),
    request("/api/search/v2?kind=albums&q=daft+punk", f),
  ]);
  expect(songs.status).toBe(503);
  expect(await songs.json()).toEqual({
    code: "music_search_unavailable",
    message: "Music search is unavailable right now.",
  });
  expect(library.status).toBe(200);
  expect(albums.status).toBe(200);
  const searches = await metricValues("streambot_web_search_total");
  const sample = (kind: string, provider: string, outcome: string) =>
    searches.find(
      (value) =>
        value.labels["kind"] === kind &&
        value.labels["provider"] === provider &&
        value.labels["outcome"] === outcome,
    )?.value;
  expect(sample("songs", "youtube-music", "unavailable")).toBe(1);
  expect(sample("library", "local", "results")).toBe(1);
  expect(sample("albums", "youtube-music", "results")).toBe(1);
});

test("an invalid kind or missing server is refused", async () => {
  const f = start();
  expect(await statusOf("/api/search/v2?kind=podcasts&q=x", f)).toBe(400);
  expect(await statusOf("/api/search/v2?q=x", f)).toBe(400);
  expect(
    await statusOf("/api/search/v2?kind=songs&q=x", f, "100000000000000011"),
  ).toBe(403);
  // The classic endpoints keep answering beside the unified ones.
  expect(await statusOf("/api/library", f)).toBe(200);
  expect(await statusOf("/api/search?query=arrival", f)).toBe(200);
});

test("search and typeahead draw on their own budget and still return the 429 shape", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const f = start();
  f.setSearchProvider("musicbrainz");
  // More than the 120 requests per minute that protect commands.
  for (let index = 0; index < 150; index += 1)
    expect(await statusOf("/api/search/v2/suggest?q=g", f)).toBe(200);
  expect(await statusOf("/api/me", f)).toBe(200);
  for (let index = 150; index < 600; index += 1)
    await request("/api/search/v2/suggest?q=g", f);
  const limited = await request("/api/search/v2/suggest?q=g", f);
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({
    code: "rate_limit",
    message: "Too many requests. Try again shortly.",
  });
  // The command budget is a separate counter and is untouched by search.
  expect(await statusOf("/api/me", f)).toBe(200);
}, 30_000);

test("what the room says is available is exactly what search serves", async () => {
  const configs = [
    { music: true, history: true, sports: true, listen: true },
    { music: false, history: false, sports: false, listen: false },
    { music: true, history: false, sports: true, listen: false },
    { music: false, history: true, sports: false, listen: true },
  ];
  for (const config of configs) {
    fixture?.playback.deps.music?.loads.close();
    fixture?.close();
    history?.close();
    const f = start({ musicEnabled: config.music }, config.history);
    f.setSportsEnabled(config.sports);
    f.setMusicOverVoice(config.listen);
    const roomResponse = await f.handler(getRequest(f, "/api/room"));
    const room = RoomSchema.parse(await roomResponse.json());
    const capabilities = room.capabilities;
    expect(capabilities.musicCatalog).toBe(config.music);
    const expected: Record<string, [string, boolean]> = {
      songs: ["get lucky", capabilities.musicCatalog],
      albums: ["daft punk", capabilities.musicCatalog],
      artists: ["daft punk", capabilities.musicCatalog],
      library: ["arrival", true],
      videos: ["khruangbin", true],
      live: ["", capabilities.sports],
      history: ["", capabilities.history],
    };
    for (const [kind, [q, available]] of Object.entries(expected)) {
      const status = await statusOf(
        "/api/search/v2?" + new URLSearchParams({ kind, q }).toString(),
        f,
      );
      expect(status === 200, kind).toBe(available);
    }
    const videos = await firstActions(f, "videos", "khruangbin");
    expect(videos?.includes("listen")).toBe(capabilities.listen);
    if (capabilities.musicCatalog) {
      // Songs always have exactly one button; Watch sits in the menu only when Listen is the button.
      const song = await firstRow(f, "songs", "get lucky");
      expect(song?.actions).toEqual([capabilities.listen ? "listen" : "watch"]);
      expect(song?.menuActions).toEqual(
        capabilities.listen ? ["watch"] : undefined,
      );
    }
  }
});

test("a very long album keeps every selection it returns redeemable", async () => {
  const f = start();
  const base = replayProvider();
  const detail = await base.albumTracks(ALBUM_ID, new AbortController().signal);
  const template = detail.tracks[0];
  if (template === undefined) throw new Error("Expected an album track");
  const tracks = Array.from({ length: 250 }, (_, index) => ({
    ...template,
    id: "track" + String(index).padStart(6, "0"),
    canonicalUrl:
      "https://music.youtube.com/watch?v=track" +
      String(index).padStart(6, "0"),
  }));
  f.playback.deps.musicSearch = createMusicSearchProviders(
    {
      "youtube-music": {
        name: "youtube-music",
        search: base.search,
        suggestions: base.suggestions,
        artistTop: base.artistTop,
        albumTracks: () => Promise.resolve({ album: detail.album, tracks }),
      },
      musicbrainz: new MusicBrainzProvider(fixtureMusic().catalog),
    },
    () => Promise.resolve("youtube-music"),
  );
  const response = await request("/api/music/v2/album?id=" + ALBUM_ID, f);
  const page = BrowsePageSchema.parse(await response.json());
  expect(page.rows).toHaveLength(150);
  if (page.play === undefined)
    throw new Error("Expected a whole-album selection");
  const first = page.rows[0];
  const last = page.rows.at(-1);
  for (const row of [first, last]) {
    if (row === undefined) throw new Error("Expected a row");
    const played = await play(f, row, "listen");
    expect(played.status).toBe(200);
  }
  const whole = await f.handler(
    f.command({
      action: "play",
      selection: { kind: "music", id: page.play.id },
      placement: "queue",
      transport: "listen",
    }),
  );
  expect(whole.status).toBe(200);
});

test("a pasted sports link offers Watch only", async () => {
  const f = start();
  const event = FIXTURE_EVENTS[0];
  if (event === undefined) throw new Error("Missing sports fixture");
  expect(await firstActions(f, "videos", event.pageUrl)).toEqual(["watch"]);
});
