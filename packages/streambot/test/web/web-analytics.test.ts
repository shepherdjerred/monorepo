import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import { analyticsEventsTotal } from "@shepherdjerred/streambot/observability/analytics-metrics.ts";
import { AnalyticsIdentityStore } from "@shepherdjerred/streambot/observability/analytics-identity.ts";
import {
  createUsageAnalytics,
  installUsageAnalytics,
  latencyBucket,
  type UsageTransport,
  type UsageTransportMessage,
} from "@shepherdjerred/streambot/observability/product-analytics.ts";
import { observePlay } from "@shepherdjerred/streambot/commands/play-observation.ts";
import {
  currentSelectionKind,
  withSelectionKind,
} from "@shepherdjerred/streambot/observability/usage-context.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { MusicAlbumSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { MeSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { fixtureMusic, ALBUM } from "#music-fixture";
import { LibraryPageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  CHANNEL,
  GUILD,
  OTHER,
  USER,
  discordLogin,
  webFixture,
} from "./web-fixture.ts";

const USERNAME = "analytics-private-username";
const QUERY = "zzprivatequery";
const PRIVATE = [
  GUILD,
  CHANNEL,
  USER,
  OTHER,
  USERNAME,
  "The living room",
  "Movie night",
  "Arrival",
  QUERY,
  "example.com",
  "http",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

let sent: UsageTransportMessage[] = [];
let enabled = true;
let transportFails = false;
let fixture: ReturnType<typeof webFixture>;
let identities: AnalyticsIdentityStore;
const transport: UsageTransport = {
  capture: (message) => {
    if (transportFails) throw new Error("transport down for " + USERNAME);
    sent.push(message);
  },
  shutdown: () => Promise.resolve(),
};

beforeEach(() => {
  sent = [];
  enabled = true;
  transportFails = false;
  analyticsEventsTotal.reset();
  identities = new AnalyticsIdentityStore(":memory:");
  installUsageAnalytics(
    createUsageAnalytics({ identities, enabled: () => enabled, transport }),
  );
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
});

function get(route: string) {
  return new Request("http://127.0.0.1:8080" + route, {
    headers: { cookie: fixture.cookie },
  });
}

async function metric(event: string, outcome: string): Promise<number> {
  const all = await register.getMetricsAsJSON();
  const found = all.find(
    (candidate) => candidate.name === "streambot_analytics_events_total",
  );
  return (found?.values ?? [])
    .filter(
      (value) =>
        value.labels["event"] === event && value.labels["outcome"] === outcome,
    )
    .reduce((total, value) => total + value.value, 0);
}

async function status(request: Request): Promise<number> {
  const response = await fixture.handler(request);
  return response.status;
}

async function json(request: Request): Promise<unknown> {
  const response = await fixture.handler(request);
  return await response.json();
}

function events(name: string) {
  return sent.filter((message) => message.event === name);
}

async function webPlay() {
  const library = LibraryPageSchema.parse(
    await json(get("/api/library?guildId=" + GUILD)),
  );
  const arrival = library.items.find((item) => item.title === "Arrival");
  if (arrival === undefined) throw new Error("Expected the Arrival fixture");
  return await fixture.handler(
    fixture.command({
      action: "play",
      selection: { kind: "library", id: arrival.id },
      placement: "queue",
    }),
  );
}

function slashService() {
  return new PlaybackCommandService({
    config: loadConfig({
      BOT_TOKEN: "bot",
      USER_TOKENS: "userbot",
      VIDEOS_DIR: "/videos",
    }),
    dispatch: vi.fn(),
    view: () => ({
      state: "idle",
      current: null,
      queue: [],
      loop: "off",
      volume: 100,
      positionSeconds: 0,
    }),
    library: () => [
      {
        title: "Local Movie",
        path: "/movies/local.mkv",
        relativePath: "local.mkv",
        library: "movies",
      },
    ],
    setVolume: () => Promise.resolve(true),
    seek: () => Promise.resolve(true),
    resolvePlaySource: () =>
      Promise.resolve({
        title: "Resolved",
        ffmpegInput: "fixture",
        mediaKind: "video",
        chapters: [],
      }),
    announce: () => Promise.resolve(),
  });
}

test("a web play, a music batch, a rejected command, a search and a slash play have exact event shapes", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    music: fixtureMusic(),
    musicEnabled: true,
    username: USERNAME,
  });
  const played = await webPlay();
  expect(played.status).toBe(200);

  const album = MusicAlbumSchema.parse(
    await json(get("/api/music/album?album=" + ALBUM + "&guildId=" + GUILD)),
  );
  const batch = await fixture.handler(
    fixture.command({
      action: "play",
      selection: { kind: "music", id: album.selectionId },
      placement: "next",
    }),
  );
  expect(batch.status).toBe(200);

  const stale = fixture.command({ action: "remove", position: 1 });
  await fixture.seed();
  fixture.handle.dispatch({
    type: "ADD",
    source: {
      kind: "file",
      path: "/media/movies/arrival.mkv",
      title: "Arrival",
    },
    requesterId: USER,
  });
  expect(await status(stale)).toBe(409);

  const query = new URLSearchParams({ guildId: GUILD, query: QUERY });
  expect(await status(get("/api/search?" + query.toString()))).toBe(200);

  await slashService().play({
    query: "Local Movie",
    source: "local",
    placement: "now",
    userId: UserIdSchema.parse(USER),
    surface: "slash",
  });

  expect(events("streambot_play_requested").map((m) => m.properties)).toEqual([
    {
      surface: "web",
      outcome: "ok",
      placement: "queue",
      batch: false,
      selection_kind: "library",
      app: "streambot",
    },
    {
      surface: "web",
      outcome: "ok",
      placement: "next",
      batch: true,
      selection_kind: "music",
      app: "streambot",
    },
    {
      surface: "slash",
      outcome: "ok",
      placement: "now",
      batch: false,
      app: "streambot",
    },
  ]);
  expect(events("streambot_command_used").map((m) => m.properties)).toEqual([
    {
      surface: "web",
      action: "remove",
      outcome: "conflict",
      code: "playback_changed",
      app: "streambot",
    },
  ]);
  const searches = events("streambot_search_performed");
  expect(searches).toHaveLength(1);
  expect(searches[0]?.properties).toEqual({
    surface: "web",
    source: "candidates",
    had_results: true,
    latency_bucket: "<250ms",
    app: "streambot",
  });
});

test("distinct ids are stable UUIDs per user and contain no Discord or content data", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    username: USERNAME,
  });
  await webPlay();
  await webPlay();
  const query = new URLSearchParams({ guildId: GUILD, query: QUERY });
  await fixture.handler(get("/api/search?" + query.toString()));
  const service = slashService();
  await service.play({
    query: "Local Movie",
    source: "local",
    placement: "queue",
    userId: UserIdSchema.parse(OTHER),
    surface: "slash",
  });

  const ids = new Set(sent.map((message) => message.distinctId));
  expect(ids.size).toBe(2);
  for (const id of ids) expect(id).toMatch(UUID);
  const mine = sent.filter(
    (message) => message.event === "streambot_play_requested",
  );
  expect(mine[0]?.distinctId).toBe(mine[1]?.distinctId);
  expect(mine[2]?.distinctId).not.toBe(mine[0]?.distinctId);

  const me = MeSchema.parse(await json(get("/api/me")));
  expect(me.analyticsId).toBe(mine[0]?.distinctId);

  const haystack = JSON.stringify(sent);
  for (const value of PRIVATE) expect(haystack).not.toContain(value);
  expect(haystack).not.toMatch(/https?:/u);
});

test("disabled flag sends nothing and counts disabled", async () => {
  fixture = webFixture();
  enabled = false;
  await webPlay();
  expect(sent).toEqual([]);
  expect(await metric("streambot_play_requested", "disabled")).toBe(1);
  expect(await metric("streambot_play_requested", "captured")).toBe(0);
});

test("a failing transport never changes the response and is counted without payloads", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    username: USERNAME,
  });
  transportFails = true;
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  const played = await webPlay();
  expect(played.status).toBe(200);
  expect(await metric("streambot_play_requested", "failed")).toBe(1);
  const output = lines.join("");
  expect(output).toContain("analytics capture failed");
  expect(output).not.toContain(USERNAME);
});

test("an analytics id survives a restart and latency is bucketed", async () => {
  const file = path.join(
    tmpdir(),
    "streambot-analytics-" + randomUUID() + ".sqlite",
  );
  try {
    const first = new AnalyticsIdentityStore(file);
    const id = first.idFor(USER);
    first.close();
    const second = new AnalyticsIdentityStore(file);
    expect(second.idFor(USER)).toBe(id);
    expect(second.idFor(OTHER)).not.toBe(id);
    second.close();
  } finally {
    await Bun.file(file).delete();
  }
  expect(latencyBucket(10)).toBe("<250ms");
  expect(latencyBucket(500)).toBe("250-1000ms");
  expect(latencyBucket(2000)).toBe("1-3s");
  expect(latencyBucket(5000)).toBe("3-10s");
  expect(latencyBucket(20_000)).toBe(">10s");
  fixture = webFixture();
});

test("a successful sign-in is captured for the signed-in user only", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    username: USERNAME,
  });
  const response = await discordLogin(fixture.handler);
  expect(response.status).toBe(302);
  expect(events("streambot_web_signed_in").map((m) => m.properties)).toEqual([
    { outcome: "success", app: "streambot" },
  ]);
  expect(JSON.stringify(sent)).not.toContain(USER);
});

test("the web selection kind is scoped to its own request under concurrency", async () => {
  fixture = webFixture();
  const play = (kind: "library" | "music", delayMs: number) =>
    withSelectionKind(kind, () =>
      observePlay(
        {
          surface: "web",
          userId: UserIdSchema.parse(USER),
          placement: "queue",
          signal: new AbortController().signal,
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          expect(currentSelectionKind()).toBe(kind);
        },
      ),
    );
  await Promise.all([play("library", 20), play("music", 5)]);
  expect(currentSelectionKind()).toBeUndefined();
  await observePlay(
    {
      surface: "web",
      userId: UserIdSchema.parse(USER),
      placement: "queue",
    },
    () => Promise.resolve(),
  );
  const kinds = events("streambot_play_requested").map(
    (message) => message.properties["selection_kind"],
  );
  expect(kinds).toHaveLength(3);
  expect(kinds).toEqual(
    expect.arrayContaining(["library", "music", undefined]),
  );
});
