import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import {
  playRequestsTotal,
  webCommandDurationSeconds,
  webCommandsTotal,
  webLoginsTotal,
  webRequestDurationSeconds,
  musicProviderDroppedItemsTotal,
  musicProviderRequestsTotal,
  webRequestsTotal,
  webSearchDurationSeconds,
  webSearchTotal,
  webTimeToPlaybackSeconds,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { MusicAlbumSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { fixtureMusic, ALBUM } from "#music-fixture";
import { LibraryPageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";
import { discordLogin } from "./web-fixture-login.ts";
import { fixtureSports } from "./web-fixture-media.ts";

const USERNAME = "telemetry-private-username";
const QUERY = "zzprivatequery";
const PRIVATE = [
  GUILD,
  CHANNEL,
  USER,
  USERNAME,
  "The living room",
  "Movie night",
  "Arrival",
  QUERY,
  "example.com",
];

const exporter = new InMemorySpanExporter();
const sdk = new NodeSDK({
  autoDetectResources: false,
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
let fixture: ReturnType<typeof webFixture>;
let lines: string[] = [];

beforeAll(() => {
  sdk.start();
});
beforeEach(() => {
  lines = [];
  exporter.reset();
  for (const metric of [
    webRequestsTotal,
    webRequestDurationSeconds,
    webCommandsTotal,
    webCommandDurationSeconds,
    webLoginsTotal,
    webTimeToPlaybackSeconds,
    playRequestsTotal,
    webSearchTotal,
    webSearchDurationSeconds,
    musicProviderRequestsTotal,
    musicProviderDroppedItemsTotal,
  ])
    metric.reset();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
});

type Entry = Record<string, unknown>;
function logs(message: string): Entry[] {
  return lines
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.startsWith("{"))
    .map((line): Entry => JSON.parse(line))
    .filter((entry) => entry["message"] === message);
}

async function count(name: string, labels: Record<string, string>) {
  const base = name.replace(/_count$/u, "");
  const all = await register.getMetricsAsJSON();
  const metric = all.find((candidate) => candidate.name === base);
  return (metric?.values ?? [])
    .filter(
      (value) =>
        (name === base ||
          ("metricName" in value && value.metricName === name)) &&
        Object.entries(labels).every(
          ([key, want]) => value.labels[key] === want,
        ),
    )
    .reduce((total, value) => total + value.value, 0);
}

function get(path: string) {
  return new Request("http://127.0.0.1:8080" + path, {
    headers: { cookie: fixture.cookie },
  });
}

async function login() {
  return await discordLogin(fixture.handler);
}

async function json(response: Response): Promise<unknown> {
  return await response.json();
}

/** Drives login, search, play, a 409, an unexpected failure and a client abort. */
async function drive(): Promise<{ traceId: string }> {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    username: USERNAME,
  });
  const signedIn = await login();
  expect(signedIn.status).toBe(302);
  const library = LibraryPageSchema.parse(
    await json(await fixture.handler(get("/api/library?guildId=" + GUILD))),
  );
  const arrival = library.items.find((item) => item.title === "Arrival");
  if (arrival === undefined) throw new Error("Expected the Arrival fixture");
  const query = new URLSearchParams({ guildId: GUILD, query: QUERY });
  const search = await fixture.handler(get("/api/search?" + query.toString()));
  expect(search.status).toBe(200);
  const played = await fixture.handler(
    fixture.command({
      action: "play",
      selection: { kind: "library", id: arrival.id },
      placement: "queue",
    }),
  );
  expect(played.status).toBe(200);
  const traceId = played.headers.get("x-trace-id") ?? "";
  expect(traceId).toMatch(/^[0-9a-f]{32}$/u);
  const listened = await fixture.handler(
    fixture.command({
      action: "play",
      selection: { kind: "url", url: "https://example.com/" + QUERY },
      placement: "queue",
      transport: "listen",
    }),
  );
  expect(listened.status).toBe(200);
  // The channel name is returned to the requesting viewer only.
  expect(await listened.json()).toMatchObject({
    destination: { transport: "listen", voiceChannelName: "Movie night" },
  });

  await fixture.seed();
  const stale = fixture.command({ action: "remove", position: 1 });
  fixture.handle.dispatch({
    type: "ADD",
    source: {
      kind: "file",
      path: "/media/movies/arrival.mkv",
      title: "Arrival",
    },
    requesterId: USER,
  });
  const conflict = await fixture.handler(stale);
  expect(conflict.status).toBe(409);

  vi.spyOn(fixtureSports, "listToday").mockRejectedValueOnce(
    new Error("private provider failure for " + USERNAME),
  );
  const failed = await fixture.handler(get("/api/sports?guildId=" + GUILD));
  expect(failed.status).toBe(503);

  const aborter = new AbortController();
  vi.spyOn(fixtureSports, "listToday").mockImplementationOnce(() => {
    aborter.abort();
    return Promise.reject(new DOMException("aborted", "AbortError"));
  });
  await fixture.handler(
    new Request("http://127.0.0.1:8080/api/sports?guildId=" + GUILD, {
      headers: { cookie: fixture.cookie },
      signal: aborter.signal,
    }),
  );
  return { traceId };
}

function finishedSpans() {
  return exporter.getFinishedSpans();
}

test("requests, commands, logins and play outcomes are counted with closed labels", async () => {
  await drive();
  const request = (route: string, statusClass: string, code: string) =>
    count("streambot_web_requests_total", {
      route,
      status_class: statusClass,
      code,
    });
  expect(await request("/api/commands", "2xx", "ok")).toBe(2);
  expect(await request("/api/commands", "4xx", "playback_changed")).toBe(1);
  expect(await request("/api/sports", "5xx", "unavailable")).toBe(1);
  expect(await request("/api/sports", "aborted", "client_aborted")).toBe(1);
  expect(await request("/api/auth/discord/callback", "3xx", "ok")).toBe(1);
  expect(
    await count("streambot_web_request_duration_seconds_count", {
      route: "/api/search",
    }),
  ).toBe(1);
  const command = (action: string, transport: string, outcome: string) =>
    count("streambot_web_commands_total", { action, transport, outcome });
  expect(await command("play", "unspecified", "ok")).toBe(1);
  expect(await command("play", "listen", "ok")).toBe(1);
  expect(await command("remove", "unspecified", "conflict")).toBe(1);
  expect(
    await count("streambot_web_command_duration_seconds_count", {
      action: "play",
    }),
  ).toBe(2);
  expect(
    await count("streambot_web_logins_total", { outcome: "success" }),
  ).toBe(1);
  expect(
    await count("streambot_play_requests_total", {
      surface: "web",
      outcome: "ok",
    }),
  ).toBe(2);
});

test("request, command and login log lines have a closed shape and aborts are not errors", async () => {
  const { traceId } = await drive();
  const requestLines = logs("web request");
  expect(
    requestLines.find((entry) => entry["route"] === "/api/search"),
  ).toMatchObject({
    level: "info",
    method: "GET",
    status: 200,
    code: "ok",
    outcome: "ok",
    duration_ms: expect.any(Number),
  });
  expect(
    requestLines.filter((entry) => entry["outcome"] === "aborted"),
  ).toMatchObject([{ level: "info", route: "/api/sports" }]);
  expect(logs("web request failed")).toHaveLength(1);
  expect(logs("web command")).toContainEqual(
    expect.objectContaining({
      action: "play",
      placement: "queue",
      selection_kind: "library",
      transport: "unspecified",
      outcome: "ok",
      code: "ok",
      duration_ms: expect.any(Number),
      traceId,
    }),
  );
  expect(logs("web command")).toContainEqual(
    expect.objectContaining({
      action: "play",
      selection_kind: "url",
      transport: "listen",
      outcome: "ok",
    }),
  );
  expect(logs("web command")).toContainEqual(
    expect.objectContaining({
      action: "remove",
      outcome: "conflict",
      code: "playback_changed",
    }),
  );
  expect(logs("web login")).toMatchObject([{ outcome: "success" }]);
});

test("the command span is a child of the request span and the response names the trace", async () => {
  const { traceId } = await drive();
  const spans = finishedSpans();
  const commandSpan = spans.find(
    (span) =>
      span.name === "streambot.web.command" &&
      span.attributes["streambot.web.action"] === "play",
  );
  expect(commandSpan?.spanContext().traceId).toBe(traceId);
  const requestSpan = spans.find(
    (span) =>
      span.name === "streambot.web.request" &&
      span.spanContext().traceId === traceId,
  );
  expect(commandSpan?.parentSpanContext?.spanId).toBe(
    requestSpan?.spanContext().spanId,
  );
  expect(requestSpan?.attributes).toMatchObject({
    "streambot.web.route": "/api/commands",
    "http.request.method": "POST",
    "http.response.status_code": 200,
    "streambot.web.code": "ok",
  });
  const failedSpan = spans.find(
    (span) => span.attributes["http.response.status_code"] === 503,
  );
  expect(failedSpan?.status.code).toBe(2);
  const abortedSpan = spans.find(
    (span) => span.attributes["streambot.web.outcome"] === "aborted",
  );
  expect(abortedSpan?.status.code).toBe(0);
});

test("no log line, metric label or span attribute carries identifying data", async () => {
  await drive();
  const spans = finishedSpans();
  const all = await register.getMetricsAsJSON();
  const haystack = JSON.stringify({
    logs: lines,
    metrics: all
      .filter((metric) => /^streambot_(?:web|play)_/u.test(metric.name))
      .flatMap((metric) => metric.values.map((value) => value.labels)),
    spans: spans.map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    })),
  });
  for (const value of PRIVATE) expect(haystack).not.toContain(value);
});

test("a web music selection counts as one web play request, not one per track", async () => {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    music: fixtureMusic(),
    musicEnabled: true,
  });
  const album = MusicAlbumSchema.parse(
    await json(
      await fixture.handler(
        get("/api/music/album?album=" + ALBUM + "&guildId=" + GUILD),
      ),
    ),
  );
  expect(album.tracks.length).toBeGreaterThan(1);
  const played = await fixture.handler(
    fixture.command({
      action: "play",
      selection: { kind: "music", id: album.selectionId },
      placement: "queue",
    }),
  );
  expect(played.status).toBe(200);
  expect(
    await count("streambot_play_requests_total", {
      surface: "web",
      outcome: "ok",
    }),
  ).toBe(1);
  fixture.playback.deps.music?.loads.close();
});

/** Everything a search could leak: the typed and corrected queries and what the provider returned. */
const SEARCH_PRIVATE = [
  USERNAME,
  QUERY,
  "get lucky",
  "Get Lucky",
  "bohemian",
  "rapsody",
  "rhapsody",
  "Random Access Memories",
  "Daft Punk",
  "Pharrell",
  "Giorgio",
  "4D7u5KF7SP8",
  "MPREb_K8qWMWVqXGi",
  "UCRr1xG_2WIDs18a6cIiCxeA",
  "Arrival",
  "music.youtube.com",
];

async function statusOf(request: Request): Promise<number> {
  const response = await fixture.handler(request);
  return response.status;
}

async function driveSearch() {
  fixture = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    music: fixtureMusic(),
    musicEnabled: true,
    username: USERNAME,
  });
  const searches: [string, string][] = [
    ["songs", "get lucky"],
    ["songs", "bohemian rapsody"],
    ["albums", "daft punk"],
    ["artists", "daft punk"],
    ["library", "arrival"],
    ["videos", "get lucky"],
    ["live", ""],
    ["songs", QUERY],
  ];
  const statuses: number[] = [];
  for (const [kind, q] of searches) {
    const query = new URLSearchParams({ guildId: GUILD, kind, q });
    statuses.push(await statusOf(get("/api/search/v2?" + query.toString())));
  }
  for (const path of [
    "/api/search/v2/suggest?q=get+lu",
    "/api/music/v2/album?guildId=" + GUILD + "&id=MPREb_K8qWMWVqXGi",
    "/api/music/v2/artist?guildId=" + GUILD + "&id=UCRr1xG_2WIDs18a6cIiCxeA",
  ])
    statuses.push(await statusOf(get(path)));
  return statuses;
}

test("search is counted, traced and logged with closed labels, one line per group", async () => {
  const statuses = await driveSearch();
  // The last typed query has no recording, so that group fails like an unreachable provider would.
  expect(statuses).toEqual([
    200, 200, 200, 200, 200, 200, 200, 503, 200, 200, 200,
  ]);
  const sample = (kind: string, provider: string, outcome: string) =>
    count("streambot_web_search_total", { kind, provider, outcome });
  expect(await sample("songs", "youtube-music", "results")).toBe(2);
  expect(await sample("songs", "youtube-music", "unavailable")).toBe(1);
  expect(await sample("albums", "youtube-music", "results")).toBe(1);
  expect(await sample("library", "local", "results")).toBe(1);
  expect(await sample("videos", "youtube", "results")).toBe(1);
  expect(await sample("live", "sports", "results")).toBe(1);
  expect(
    await count("streambot_web_search_duration_seconds_count", {
      kind: "songs",
      provider: "youtube-music",
    }),
  ).toBe(3);
  const operation = (name: string, outcome: string) =>
    count("streambot_music_provider_requests_total", {
      provider: "youtube-music",
      operation: name,
      outcome,
    });
  expect(await operation("search_song", "ok")).toBe(2);
  expect(await operation("search_song", "unavailable")).toBe(1);
  expect(await operation("suggest", "ok")).toBe(1);
  expect(await operation("album", "ok")).toBe(1);
  expect(await operation("artist", "ok")).toBe(1);

  const searchLines = logs("web search");
  expect(searchLines).toHaveLength(8);
  expect(searchLines).toContainEqual(
    expect.objectContaining({
      level: "info",
      kind: "songs",
      provider: "youtube-music",
      results: "1-5",
      outcome: "results",
      duration_ms: expect.any(Number),
    }),
  );
  for (const entry of searchLines)
    expect(Object.keys(entry).toSorted()).toEqual(
      [
        "duration_ms",
        "kind",
        "level",
        "message",
        "module",
        "outcome",
        "provider",
        "results",
        "timestamp",
        ...("traceId" in entry ? ["spanId", "traceId"] : []),
      ].toSorted(),
    );

  const spans = finishedSpans();
  const groups = spans.filter((span) => span.name === "streambot.web.search");
  expect(groups).toHaveLength(8);
  const provider = spans.find(
    (span) =>
      span.name === "streambot.web.search.provider" &&
      span.attributes["streambot.music.operation"] === "search_song",
  );
  expect(provider?.attributes).toMatchObject({
    "streambot.music.provider": "youtube-music",
    "streambot.music.outcome": "ok",
  });
  expect(
    groups.some(
      (span) =>
        span.spanContext().spanId === provider?.parentSpanContext?.spanId,
    ),
  ).toBe(true);
});

test("no search log line, metric label or span attribute carries a query or a result", async () => {
  await driveSearch();
  const all = await register.getMetricsAsJSON();
  const haystack = JSON.stringify({
    logs: lines,
    metrics: all
      .filter((metric) => /^streambot_(?:web|play|music)_/u.test(metric.name))
      .flatMap((metric) => metric.values.map((value) => value.labels)),
    spans: finishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    })),
  });
  for (const value of SEARCH_PRIVATE) expect(haystack).not.toContain(value);
});
