import { afterEach, expect, test, vi } from "vitest";
import { waitFor } from "xstate";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { UnsupportedVideoRequestError } from "@shepherdjerred/streambot/sources/resolve.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  CommandResultSchema,
  LibraryPageSchema,
  SportsResultsSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  BrowsePageSchema,
  SearchResponseSchema,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { fixtureMusic, SONG } from "#music-fixture";
import { ALBUM_ID } from "#youtube-music-fixture";
import { harness, number } from "#numbered-fixture";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture>;
let history: MediaHistoryStore | undefined;
afterEach(() => {
  fixture.playback.deps.music?.loads.close();
  fixture.close();
  history?.close();
  history = undefined;
});
const scope = { guildId: GUILD, channelId: CHANNEL, userId: USER };
const ORIGIN = "http://127.0.0.1:8080";

/** Media whose final probe finds no picture: an explicit video request fails like production. */
function resolveFixture(source: Source): ResolvedSource {
  const audioOnly =
    (source.kind === "url" && source.url.includes("audio-only")) ||
    (source.kind === "file" && source.path.includes("whiplash"));
  if (audioOnly && source.mode === "video")
    throw new UnsupportedVideoRequestError("Fixture song");
  return {
    title: "Clip",
    ffmpegInput: "fixture",
    mediaKind: audioOnly || source.mode === "music" ? "music" : "video",
    chapters: [],
  };
}

function start(numbered: boolean) {
  history = new MediaHistoryStore(":memory:");
  fixture = webFixture(ORIGIN, "/nonexistent", false, {
    history,
    music: fixtureMusic(),
    musicEnabled: true,
    resolve: resolveFixture,
    expandPlaylist: () =>
      Promise.resolve([
        {
          title: "Linked",
          url: "https://www.youtube.com/watch?v=h5EofwRzit0",
        },
      ]),
  });
  return numbered ? harness() : Promise.resolve(undefined);
}

async function numberedRoom() {
  const room = await start(true);
  if (room === undefined) throw new Error("Expected a numbered room");
  fixture.playback.deps.sessions = room.manager;
  return room;
}

async function get(path: string): Promise<unknown> {
  const response = await fixture.handler(
    new Request(
      ORIGIN + path + (path.includes("?") ? "&" : "?") + "guildId=" + GUILD,
      {
        headers: { cookie: fixture.cookie },
      },
    ),
  );
  expect(response.status).toBe(200);
  return await response.json();
}

const media = (id: string) => ({
  kind: "url",
  url: "https://example.com/" + id,
});

async function libraryId(title: string) {
  const page = LibraryPageSchema.parse(await get("/api/library"));
  const item = page.items.find((entry) => entry.title === title);
  if (item === undefined) throw new Error("Missing library fixture " + title);
  return item.id;
}

async function candidateId() {
  const results = SearchResponseSchema.parse(
    await get("/api/search/v2?kind=videos&q=tiny+desk"),
  );
  const candidate = results.items.find((entry) => entry.kind === "video");
  if (candidate === undefined) throw new Error("Missing YouTube candidate");
  return candidate.id;
}

async function albumSelection() {
  const album = BrowsePageSchema.parse(
    await get("/api/music/v2/album?id=" + ALBUM_ID),
  );
  if (album.play === undefined) throw new Error("Missing album play");
  return album.play.id;
}

function playlistSelection() {
  if (history === undefined) throw new Error("Missing history fixture");
  const playlist = history.playlists.create(
    { userId: USER, guildId: GUILD },
    "Mix " + crypto.randomUUID(),
    [{ title: SONG.title, source: musicSource(SONG) }],
  );
  return { kind: "playlist", id: playlist.id, revision: playlist.revision };
}

async function play(
  selection: Record<string, unknown>,
  transport: "listen" | "watch",
  extra: Record<string, unknown> = {},
) {
  return await fixture.handler(
    fixture.command({
      action: "play",
      placement: "queue",
      selection,
      playbackChannel: null,
      revision: null,
      transport,
      ...extra,
    }),
  );
}

async function ok(response: Response) {
  expect(response.status).toBe(200);
  return CommandResultSchema.parse(await response.json());
}

async function refusal(response: Response) {
  expect(response.status).toBe(409);
  const body: unknown = await response.json();
  return body;
}

function slotModes(
  room: Awaited<ReturnType<typeof numberedRoom>>,
  slot: number,
) {
  const view = room.manager.getExisting(GUILD, CHANNEL, number(slot))?.view();
  return [view?.current, ...(view?.queue ?? [])].flatMap((item) =>
    item?.source === undefined ? [] : [item.source.mode],
  );
}

const selections: [string, () => Promise<Record<string, unknown>>][] = [
  [
    "library file",
    async () => ({ kind: "library", id: await libraryId("Arrival") }),
  ],
  [
    "YouTube candidate",
    async () => ({ kind: "candidate", id: await candidateId() }),
  ],
  [
    "pasted URL",
    () => Promise.resolve({ kind: "url", url: "https://example.com/clip" }),
  ],
  [
    "music selection",
    async () => ({ kind: "music", id: await albumSelection() }),
  ],
  ["playlist", () => Promise.resolve(playlistSelection())],
];

test.each(selections)(
  "Listen and Watch land a %s on slots 1 and 2 without touching personal selection",
  async (_name, selection) => {
    const room = await numberedRoom();
    room.manager.numbered.selection.select(scope, 3, 4);
    const listened = await ok(await play(await selection(), "listen"));
    expect(listened.destination).toEqual({
      transport: "listen",
      voiceChannelName: "Movie night",
    });
    const watched = await ok(await play(await selection(), "watch"));
    expect(watched.destination).toEqual({
      transport: "watch",
      voiceChannelName: "Movie night",
    });
    await vi.waitFor(() => {
      expect(slotModes(room, 1).length).toBeGreaterThan(0);
      expect(slotModes(room, 2).length).toBeGreaterThan(0);
    });
    expect(new Set(slotModes(room, 1))).toEqual(new Set(["music"]));
    expect(new Set(slotModes(room, 2))).toEqual(new Set(["video"]));
    expect(room.manager.getExisting(GUILD, CHANNEL, number(3))).toBeNull();
    expect(room.manager.numbered.selection.get(scope)).toBe(3);
    expect(room.manager.numbered.selection.isManual(scope)).toBe(true);
    expect(room.manager.numbered.selection.lastTarget(scope)).toBeUndefined();
  },
);

test("Watch on a song plays its matched video, Listen on a link plays its audio", async () => {
  const room = await numberedRoom();
  await ok(await play({ kind: "music", id: await albumSelection() }, "watch"));
  await ok(
    await play(
      { kind: "url", url: "https://www.youtube.com/playlist?list=PLfixture" },
      "listen",
    ),
  );
  await vi.waitFor(() => {
    expect(slotModes(room, 1)).toContain("music");
  });
  expect(new Set(slotModes(room, 2))).toEqual(new Set(["video"]));
  await expect
    .poll(() => room.plays.map((entry) => entry.transport).toSorted())
    .toEqual(["music", "video"]);
});

test("an explicit extra stream targets slot 3 and is refused beyond the maximum", async () => {
  const room = await numberedRoom();
  const url = { kind: "url", url: "https://example.com/clip" };
  const extra = await ok(await play(url, "watch", { playbackChannel: 3 }));
  expect(extra.destination?.transport).toBe("watch");
  await vi.waitFor(() => {
    expect(slotModes(room, 3)).toEqual(["video"]);
  });
  expect(
    await refusal(await play(url, "watch", { playbackChannel: 5 })),
  ).toMatchObject({
    code: "stream_limit",
  });
  const listenElsewhere = await play(url, "listen", { playbackChannel: 2 });
  expect(listenElsewhere.status).toBe(400);
  expect(room.manager.getExisting(GUILD, CHANNEL, number(5))).toBeNull();
});

test("a command controls the slot it names regardless of personal selection", async () => {
  const room = await numberedRoom();
  await ok(
    await play({ kind: "url", url: "https://example.com/clip" }, "watch"),
  );
  await vi.waitFor(() => {
    expect(
      room.manager.getExisting(GUILD, CHANNEL, number(2))?.view().state,
    ).toBe("streaming");
  });
  expect(room.manager.numbered.selection.get(scope)).toBe(1);
  const volume = await fixture.handler(
    fixture.command({
      action: "volume",
      percent: 40,
      playbackChannel: 2,
      revision: null,
    }),
  );
  expect(volume.status).toBe(200);
  expect(
    room.manager.getExisting(GUILD, CHANNEL, number(2))?.view().volume,
  ).toBe(40);
  const missing = await fixture.handler(
    fixture.command({
      action: "stop",
      playbackChannel: null,
      revision: null,
    }),
  );
  expect(missing.status).toBe(400);
});

test("each refusal has its own code", async () => {
  await numberedRoom();
  expect(
    await refusal(
      await play(
        { kind: "url", url: "https://example.com/audio-only" },
        "watch",
      ),
    ),
  ).toMatchObject({ code: "no_video" });
  expect(
    await refusal(
      await play({ kind: "library", id: await libraryId("Whiplash") }, "watch"),
    ),
  ).toMatchObject({ code: "no_video" });
  const live = SportsResultsSchema.parse(await get("/api/sports")).find(
    (event) => event.status === "live" && event.proOnly !== true,
  );
  if (live === undefined) throw new Error("Expected a live fixture event");
  expect(
    await refusal(await play({ kind: "sports", id: live.id }, "listen")),
  ).toMatchObject({
    code: "listen_sports",
  });
  fixture.playback.deps.featureGate = {
    ...fixture.playback.deps.featureGate,
    musicOverVoice: () => Promise.resolve(false),
  };
  expect(
    await refusal(
      await play({ kind: "url", url: "https://example.com/clip" }, "listen"),
    ),
  ).toMatchObject({ code: "listen_disabled" });
});

test("a legacy room honours Listen and Watch as the item's mode and refuses extra streams", async () => {
  await start(false);
  const listened = await ok(
    await play({ kind: "library", id: await libraryId("Arrival") }, "listen"),
  );
  expect(listened).toMatchObject({
    destination: { transport: "listen" },
    position: 0,
  });
  const watched = await ok(
    await play({ kind: "url", url: "https://example.com/clip" }, "watch"),
  );
  expect(watched).toMatchObject({
    destination: { transport: "watch" },
    position: 1,
  });
  const { context } = await waitFor(fixture.actor, (state) =>
    state.matches("streaming"),
  );
  expect(
    [context.current, ...context.queue].map((item) => item?.source.mode),
  ).toEqual(["music", "video"]);
  expect(
    await refusal(
      await play({ kind: "url", url: "https://example.com/clip" }, "watch", {
        playbackChannel: 3,
      }),
    ),
  ).toMatchObject({ code: "channels_unavailable" });
});

test("destination and position describe immediate, queued, next and now placements", async () => {
  await start(false);
  expect(await ok(await play(media("first"), "watch"))).toMatchObject({
    position: 0,
  });
  await waitFor(fixture.actor, (state) => state.matches("streaming"));
  expect(await ok(await play(media("second"), "watch"))).toMatchObject({
    position: 1,
  });
  expect(await ok(await play(media("third"), "watch"))).toMatchObject({
    position: 2,
  });
  expect(
    await ok(await play(media("next"), "watch", { placement: "next" })),
  ).toMatchObject({ position: 1 });
  const now = await ok(await play(media("now"), "watch", { placement: "now" }));
  expect(now).toMatchObject({
    position: 0,
    destination: { transport: "watch", voiceChannelName: "Movie night" },
  });
});
