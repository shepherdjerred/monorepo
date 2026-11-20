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
  webRequestsTotal,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { MusicAlbumSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { fixtureMusic, ALBUM } from "#music-fixture";
import { LibraryPageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";
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
    playRequestsTotal,
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
  const start = await fixture.handler(
    new Request("http://127.0.0.1:8080/api/auth/discord/start"),
  );
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return await fixture.handler(
    new Request(
      "http://127.0.0.1:8080/api/auth/discord/callback?code=fixture&state=" +
        String(state),
      { headers: { cookie } },
    ),
  );
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
  expect(await request("/api/commands", "2xx", "ok")).toBe(1);
  expect(await request("/api/commands", "4xx", "playback_changed")).toBe(1);
  expect(await request("/api/sports", "5xx", "unavailable")).toBe(1);
  expect(await request("/api/sports", "aborted", "client_aborted")).toBe(1);
  expect(await request("/api/auth/discord/callback", "3xx", "ok")).toBe(1);
  expect(
    await count("streambot_web_request_duration_seconds_count", {
      route: "/api/search",
    }),
  ).toBe(1);
  const command = (action: string, outcome: string) =>
    count("streambot_web_commands_total", { action, outcome });
  expect(await command("play", "ok")).toBe(1);
  expect(await command("remove", "conflict")).toBe(1);
  expect(
    await count("streambot_web_command_duration_seconds_count", {
      action: "play",
    }),
  ).toBe(1);
  expect(
    await count("streambot_web_logins_total", { outcome: "success" }),
  ).toBe(1);
  expect(
    await count("streambot_play_requests_total", {
      surface: "web",
      outcome: "ok",
    }),
  ).toBe(1);
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
      outcome: "ok",
      code: "ok",
      duration_ms: expect.any(Number),
      traceId,
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
