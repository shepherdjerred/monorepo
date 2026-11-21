import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import {
  webRequestDurationSeconds,
  webSseClosedTotal,
  webSseConnectionSeconds,
  webSseDroppedTotal,
  webSseEventsTotal,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import {
  RoomSchema,
  RoomStreamErrorSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { WebRoomRoutes } from "@shepherdjerred/streambot/web/server/room/index.ts";
import {
  HEARTBEAT_MS,
  MAX_STREAMS_PER_SESSION,
} from "@shepherdjerred/streambot/web/server/room/room-streams.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";
import {
  CHANNEL,
  GUILD,
  OTHER,
  SECOND_GUILD,
  USER,
  webFixture,
} from "./web-fixture.ts";
import {
  MOVIE_SOURCE,
  multiSlotRoom,
  resolveByMode,
  SONG_SOURCE,
  STATION,
} from "./web-fixture-room.ts";
import {
  connectEvents,
  Events,
  type EventReader,
  getRequest,
  ORIGIN,
  playerOf,
  sample,
} from "./web-room-harness.ts";

const SECOND_CHANNEL = ChannelIdSchema.parse("100000000000000021");
const USERNAME = "room-private-username";
const SLOT = (number: number) => PlaybackChannelNumberSchema.parse(number);

const exporter = new InMemorySpanExporter();
const sdk = new NodeSDK({
  autoDetectResources: false,
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
let fixture: ReturnType<typeof webFixture>;
let lines: string[] = [];
const readers: EventReader[] = [];

beforeAll(() => {
  sdk.start();
});
beforeEach(() => {
  lines = [];
  exporter.reset();
  for (const metric of [
    webRequestDurationSeconds,
    webSseClosedTotal,
    webSseConnectionSeconds,
    webSseDroppedTotal,
    webSseEventsTotal,
  ])
    metric.reset();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  fixture = webFixture(ORIGIN, "/nonexistent", true, {
    username: USERNAME,
    radioEnabled: true,
    resolve: resolveByMode,
  });
});
afterEach(async () => {
  vi.useRealTimers();
  for (const reader of readers.splice(0)) await reader.cancel().catch(ignore);
  fixture.close();
  vi.restoreAllMocks();
});

const ignore = () => {
  // The stream was already closed by the server.
};
const connect = (signal?: AbortSignal) =>
  connectEvents(fixture, readers, signal);
const notifyRoom = () => {
  fixture.changes.notify({ guildId: GUILD, channelId: CHANNEL, userId: null });
};

describe("protocol", () => {
  test("sends a full snapshot first, with retry guidance and an event id", async () => {
    const { response, events } = await connect();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const first = await events.next();
    expect(first).toMatchObject({ event: "room", id: "1", retry: "3000" });
    const value = RoomSchema.parse(JSON.parse(first?.data ?? ""));
    expect(value.location?.channel.id).toBe(CHANNEL);
  });

  test("a reconnect starts again from a fresh full snapshot", async () => {
    const slots = multiSlotRoom(fixture);
    await slots.play(1, SONG_SOURCE);
    const first = await connect();
    await first.events.room();
    await first.events.reader.cancel();
    const second = await connect();
    const frame = await second.events.next();
    expect(frame).toMatchObject({ id: "1" });
    expect(
      playerOf(RoomSchema.parse(JSON.parse(frame?.data ?? "")), 1)?.state,
    ).toBe("streaming");
  });
});

describe("pushed updates", () => {
  test("a change during the first build still produces a second snapshot", async () => {
    const pending = fixture.handler(getRequest(fixture, "/api/room/events"));
    // The handler is parked on its first await; the change lands before the stream exists.
    notifyRoom();
    const response = await pending;
    const events = new Events(response, readers);
    expect(await events.next()).toMatchObject({ id: "1" });
    expect(await events.next()).toMatchObject({ event: "room", id: "2" });
  });

  test("an actor event in each slot produces a snapshot", async () => {
    const slots = multiSlotRoom(fixture);
    for (const number of [1, 2, 3])
      await slots.play(number, number === 1 ? SONG_SOURCE : MOVIE_SOURCE);
    const { events } = await connect();
    await events.room();
    for (const [index, number] of [1, 2, 3].entries()) {
      const volume = 40 + index;
      slots.ensure(SLOT(number)).actor.send({ type: "SET_VOLUME", volume });
      const value = await events.until(
        (candidate) => playerOf(candidate, number)?.volume === volume,
      );
      expect(playerOf(value, number)?.volume).toBe(volume);
    }
  });

  test("slot creation and teardown are pushed", async () => {
    const slots = multiSlotRoom(fixture);
    const { events } = await connect();
    const idle = await events.room();
    expect(idle.players).toEqual([]);
    await slots.play(1, SONG_SOURCE);
    await events.until((value) => playerOf(value, 1)?.state === "streaming");
    slots.ensure(SLOT(1)).actor.send({ type: "STOP" });
    const value = await events.until(
      (candidate) => playerOf(candidate, 1) === undefined,
    );
    expect(value.players).toEqual([]);
  });

  test("a voice move is pushed", async () => {
    const { events } = await connect();
    await events.room();
    fixture.setChannel(null);
    await events.until((value) => value.location === null);
    fixture.setChannelIn(SECOND_GUILD, { id: SECOND_CHANNEL, name: "Studio" });
    const moved = await events.until(
      (value) => value.location?.guild.id === SECOND_GUILD,
    );
    expect(moved.browseGuildId).toBe(SECOND_GUILD);
    fixture.setChannel({ id: CHANNEL, name: "Movie night" });
    await events.until((value) => value.location?.guild.id === GUILD);
  });

  test("a station starting and stopping is pushed", async () => {
    const slots = multiSlotRoom(fixture);
    const { events } = await connect();
    await events.room();
    const sessions = fixture.playback.deps.sessions;
    const target = {
      guildId: GuildIdSchema.parse(GUILD),
      voiceChannelId: CHANNEL,
      playbackChannel: SLOT(1),
    };
    await sessions.startStation?.({
      ...target,
      statusChannelId: CHANNEL,
      station: STATION,
    });
    await events.until(
      (value) => playerOf(value, 1)?.station?.kind === "radio",
    );
    sessions.stopStation?.(target);
    await events.until((value) => playerOf(value, 1)?.station === null);
    expect(slots.slots.size).toBe(1);
  });

  test("other rooms and other viewers' voice moves cause nothing", async () => {
    const { events } = await connect();
    await events.room();
    fixture.changes.notify({
      guildId: GUILD,
      channelId: SECOND_CHANNEL,
      userId: null,
    });
    fixture.changes.notify({ guildId: GUILD, channelId: null, userId: OTHER });
    fixture.changes.notify({
      guildId: "100000000000000099",
      channelId: null,
      userId: USER,
    });
    await expect(events.next(150)).rejects.toThrow("Timed out");
  });

  test("a burst coalesces and a slow client only ever gets the latest frame", async () => {
    const slots = multiSlotRoom(fixture);
    const slot = await slots.play(1, SONG_SOURCE);
    const { events } = await connect();
    // Nothing is read yet: the first snapshot occupies the only queued frame.
    for (let wave = 0; wave < 5; wave += 1) {
      for (let burst = 0; burst < 10; burst += 1)
        slot.actor.send({ type: "SET_VOLUME", volume: 10 * wave + burst });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(
      await sample("streambot_web_sse_dropped_total"),
    ).toBeGreaterThanOrEqual(3);
    const first = await events.room();
    expect(playerOf(first, 1)?.volume).toBe(100);
    const latest = await events.room();
    expect(playerOf(latest, 1)?.volume).toBe(49);
    await expect(events.next(150)).rejects.toThrow("Timed out");
  });

  test("ids increase with every snapshot", async () => {
    const slots = multiSlotRoom(fixture);
    const slot = await slots.play(1, SONG_SOURCE);
    const { events } = await connect();
    const ids: number[] = [];
    const first = await events.next();
    ids.push(Number(first?.id));
    for (const volume of [10, 20]) {
      slot.actor.send({ type: "SET_VOLUME", volume });
      const frame = await events.next();
      ids.push(Number(frame?.id));
    }
    expect(ids).toEqual([1, 2, 3]);
  });
});

describe("keepalive and authorization", () => {
  test("writes a heartbeat comment every interval and clears the timer on close", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { events } = await connect();
    await events.room();
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(await events.next()).toMatchObject({ comment: "heartbeat" });
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(await events.next()).toMatchObject({ comment: "heartbeat" });
    expect(
      await sample("streambot_web_sse_events_total", { event: "heartbeat" }),
    ).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    await events.reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a revoked membership ends the stream with a closed error code", async () => {
    const { events } = await connect();
    await events.room();
    fixture.setMember(false);
    notifyRoom();
    const frame = await events.next();
    expect(frame?.event).toBe("error");
    expect(RoomStreamErrorSchema.parse(JSON.parse(frame?.data ?? ""))).toEqual({
      code: "guild_denied",
    });
    expect(await events.next()).toBeNull();
    expect(fixture.changes.size).toBe(0);
    expect(
      await sample("streambot_web_sse_closed_total", {
        reason: "unauthorized",
      }),
    ).toBe(1);
  });

  test("switching the web remote off ends the stream", async () => {
    const { events } = await connect();
    await events.room();
    fixture.setEnabled(false);
    notifyRoom();
    const frame = await events.next();
    expect(JSON.parse(frame?.data ?? "")).toEqual({
      code: "feature_disabled",
    });
  });

  test("an expired or deleted sign-in ends the stream at the next heartbeat", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { events } = await connect();
    await events.room();
    fixture.store.delete(
      /streambot_session=([^;]+)/u.exec(fixture.cookie)?.[1] ?? "",
    );
    vi.advanceTimersByTime(HEARTBEAT_MS);
    const frame = await events.next();
    expect(frame?.event).toBe("error");
    expect(JSON.parse(frame?.data ?? "")).toEqual({ code: "unauthorized" });
    expect(await events.next()).toBeNull();
  });

  test("a sign-out ends the viewer's streams at once", async () => {
    const { events } = await connect();
    await events.room();
    const logout = await fixture.handler(
      new Request(ORIGIN + "/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: fixture.cookie,
          origin: ORIGIN,
          "x-csrf-token": fixture.csrf,
        },
      }),
    );
    expect(logout.status).toBe(302);
    const frame = await events.next();
    expect(JSON.parse(frame?.data ?? "")).toEqual({
      code: "unauthorized",
    });
  });
});

describe("limits and cleanup", () => {
  test("a fifth stream for one session is refused with room_stream_limit", async () => {
    const open = [];
    for (let index = 0; index < MAX_STREAMS_PER_SESSION; index += 1)
      open.push(await connect());
    const refused = await fixture.handler(
      getRequest(fixture, "/api/room/events"),
    );
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      code: "room_stream_limit",
    });
    expect(
      await sample("streambot_web_sse_closed_total", { reason: "limit" }),
    ).toBe(1);
    await open[0]?.events.reader.cancel();
    const retry = await connect();
    expect(retry.response.status).toBe(200);
  });

  test("the global cap has its own 429 code", async () => {
    const routes = new WebRoomRoutes(
      fixture.playback,
      () => Promise.resolve(false),
      { perSession: 4, global: 2 },
    );
    const url = new URL(ORIGIN + "/api/room/events");
    const handle = async () =>
      await routes.handle(
        getRequest(fixture, "/api/room/events"),
        url,
        fixture.session,
        () => fixture.session,
      );
    const first = await handle();
    const second = await handle();
    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    await expect(handle()).rejects.toMatchObject({
      status: 429,
      code: "room_stream_capacity",
    });
    routes.streams.closeAll();
    expect(routes.streams.size).toBe(0);
  });

  test("leaves no listener, timer or gauge behind after many connects and disconnects", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    for (let index = 0; index < 30; index += 1) {
      const controller = new AbortController();
      const { events } = await connect(controller.signal);
      await events.room();
      expect(fixture.changes.size).toBe(1);
      if (index % 3 === 0) await events.reader.cancel();
      else if (index % 3 === 1) controller.abort();
      else {
        fixture.setMember(false);
        notifyRoom();
        await events.next();
        fixture.setMember(true);
      }
    }
    expect(fixture.changes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(await sample("streambot_web_sse_connections")).toBe(0);
    expect(await sample("streambot_web_sse_closed_total")).toBe(30);
  });

  test("closeStreams ends every stream for a server shutdown", async () => {
    const { events } = await connect();
    await events.room();
    fixture.handler.closeStreams();
    expect(await events.next()).toBeNull();
    expect(fixture.changes.size).toBe(0);
    expect(
      await sample("streambot_web_sse_closed_total", {
        reason: "server_shutdown",
      }),
    ).toBe(1);
  });

  test("a failed connect leaves nothing reserved", async () => {
    fixture.setEnabled(false);
    for (let index = 0; index < 10; index += 1) {
      const refused = await fixture.handler(
        getRequest(fixture, "/api/room/events"),
      );
      expect(refused.status).toBe(403);
    }
    fixture.setEnabled(true);
    expect(fixture.changes.size).toBe(0);
    expect(await sample("streambot_web_sse_connections")).toBe(0);
    for (let index = 0; index < MAX_STREAMS_PER_SESSION; index += 1)
      await connect();
  });
});

describe("telemetry", () => {
  test("the request span and duration end at connect, not at close", async () => {
    const { events } = await connect();
    await events.room();
    const route = { route: "/api/room/events" };
    const requests = exporter
      .getFinishedSpans()
      .filter((span) => span.name === "streambot.web.request");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.attributes["streambot.web.route"]).toBe(route.route);
    expect(requests[0]?.attributes["http.response.status_code"]).toBe(200);
    expect(
      await sample("streambot_web_request_duration_seconds_count", route),
    ).toBe(1);
    expect(
      await sample("streambot_web_request_duration_seconds_sum", route),
    ).toBeLessThan(2);
    expect(await sample("streambot_web_sse_connections")).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await events.reader.cancel();
    expect(await sample("streambot_web_sse_connections")).toBe(0);
    expect(
      await sample("streambot_web_request_duration_seconds_count", route),
    ).toBe(1);
    expect(
      await sample("streambot_web_request_duration_seconds_sum", route),
    ).toBeLessThan(2);
  });

  test("counts frames, observes the connection once and logs open and close", async () => {
    const { events } = await connect();
    await events.room();
    await events.reader.cancel();
    expect(
      await sample("streambot_web_sse_events_total", { event: "room" }),
    ).toBe(1);
    expect(await sample("streambot_web_sse_connection_seconds_count")).toBe(1);
    expect(
      await sample("streambot_web_sse_closed_total", {
        reason: "client_closed",
      }),
    ).toBe(1);
    const entries = lines
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.startsWith("{"))
      .map((line): Record<string, unknown> => JSON.parse(line));
    expect(
      entries.filter((entry) => entry["message"] === "web room stream opened"),
    ).toHaveLength(1);
    const closed = entries.filter(
      (entry) => entry["message"] === "web room stream closed",
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      reason: "client_closed",
      events_sent: 1,
      events_dropped: 0,
    });
  });

  test("no log line, metric label or span attribute carries a name, id or title", async () => {
    const slots = multiSlotRoom(fixture);
    await slots.play(1, SONG_SOURCE);
    const { events } = await connect();
    await events.room();
    slots.ensure(SLOT(1)).actor.send({ type: "SET_VOLUME", volume: 20 });
    await events.until((value) => playerOf(value, 1)?.volume === 20);
    fixture.setMember(false);
    notifyRoom();
    await events.next();
    const emitted =
      lines.join("") +
      (await register.metrics()) +
      JSON.stringify(
        exporter.getFinishedSpans().map((span) => span.attributes),
      );
    for (const secret of [
      GUILD,
      SECOND_GUILD,
      CHANNEL,
      USER,
      OTHER,
      USERNAME,
      "The living room",
      "Movie night",
      "Room Test Song",
      "Room Test Artist",
      "youtube.com",
    ])
      expect(emitted).not.toContain(secret);
  });
});
