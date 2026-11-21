import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { waitFor } from "xstate";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import { webTimeToPlaybackSeconds } from "@shepherdjerred/streambot/observability/web-metrics.ts";
import {
  CommandResultSchema,
  LibraryPageSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { CHANNEL, GUILD, USER, webFixture } from "./web-fixture.ts";
import { roomPlayer } from "./web-fixture-login.ts";

let fixture: ReturnType<typeof webFixture>;
beforeEach(() => {
  webTimeToPlaybackSeconds.reset();
});
afterEach(() => {
  fixture.close();
});

const ARRIVAL = {
  kind: "file",
  path: "/media/movies/arrival.mkv",
  title: "Arrival",
} as const;

/** An actor event the page has not seen: someone else queues the same film again. */
function actorEvent() {
  fixture.handle.dispatch({ type: "ADD", source: ARRIVAL, requesterId: USER });
}

async function status(request: Request) {
  const response = await fixture.handler(request);
  return response.status;
}

/** The room's one player: these rooms have a single queue. */
async function snapshot() {
  const player = await roomPlayer(fixture);
  if (player === undefined) throw new Error("Expected a player");
  return player;
}

async function libraryId(title: string) {
  const response = await fixture.handler(
    new Request("http://127.0.0.1:8080/api/library?guildId=" + GUILD, {
      headers: { cookie: fixture.cookie },
    }),
  );
  const item = LibraryPageSchema.parse(await response.json()).items.find(
    (entry) => entry.title === title,
  );
  if (item === undefined) throw new Error("Missing library fixture " + title);
  return item.id;
}

async function timeToPlaybackMetric() {
  const metrics = await register.getMetricsAsJSON();
  return metrics.find(
    (candidate) => candidate.name === "streambot_web_time_to_playback_seconds",
  );
}

async function timeToPlaybackSamples(): Promise<number> {
  const metric = await timeToPlaybackMetric();
  return (metric?.values ?? [])
    .filter(
      (value) =>
        "metricName" in value &&
        value.metricName === "streambot_web_time_to_playback_seconds_count",
    )
    .reduce((total, value) => total + value.value, 0);
}

test("queue-add, volume, pause and skip apply to current state after an actor event", async () => {
  fixture = webFixture();
  await fixture.seed();
  const id = await libraryId("Whiplash");
  const stale = [
    fixture.command({
      action: "play",
      placement: "queue",
      selection: { kind: "library", id },
    }),
    fixture.command({ action: "volume", percent: 55 }),
    fixture.command({ action: "pause" }),
  ];
  actorEvent();
  for (const request of stale) expect(await status(request)).toBe(200);
  const resumed = fixture.command({ action: "resume" });
  actorEvent();
  expect(await status(resumed)).toBe(200);
  await waitFor(fixture.actor, (state) => state.matches("streaming"));
  const skip = fixture.command({ action: "skip" });
  actorEvent();
  expect(await status(skip)).toBe(200);
  expect(fixture.events.map((event) => event.type)).toEqual(
    expect.arrayContaining(["ADD", "SET_VOLUME", "PAUSE", "RESUME", "SKIP"]),
  );
});

test.each(["shuffle", "clear"] as const)(
  "remove and move after %s with a stale revision are still refused",
  async (change) => {
    fixture = webFixture();
    await fixture.seed();
    actorEvent();
    actorEvent();
    const remove = fixture.command({ action: "remove", position: 1 });
    const move = fixture.command({ action: "move", from: 1, to: 2 });
    expect(await status(fixture.command({ action: change }))).toBe(200);
    const before = fixture.events.length;
    expect(await status(remove)).toBe(409);
    expect(await status(move)).toBe(409);
    expect(fixture.events).toHaveLength(before);
  },
);

test("subtitle selection stays bound to the revision the picker saw", async () => {
  fixture = webFixture();
  await fixture.seed();
  const stale = fixture.command({ action: "subtitles", token: "enumerate" });
  actorEvent();
  const response = await fixture.handler(
    new Request("http://127.0.0.1:8080/api/subtitles", {
      method: "POST",
      headers: stale.headers,
      body: await stale.text(),
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "playback_changed" });
});

test("expectCurrent refuses a stale skip or pause and accepts the item still playing", async () => {
  fixture = webFixture();
  await fixture.seed();
  const seeded = await snapshot();
  const token = seeded.current?.token;
  if (token === undefined) throw new Error("Expected a current item token");
  for (const action of ["skip", "pause", "seek"] as const) {
    const response = await fixture.handler(
      fixture.command({
        action,
        expectCurrent: "an-earlier-item",
        ...(action === "seek" ? { seconds: 30 } : {}),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "item_finished",
      message: "That item already finished.",
    });
  }
  expect(fixture.events).toHaveLength(0);
  actorEvent();
  expect(
    await status(fixture.command({ action: "pause", expectCurrent: token })),
  ).toBe(200);
  expect(
    await status(fixture.command({ action: "resume", expectCurrent: token })),
  ).toBe(200);
  await waitFor(fixture.actor, (state) => state.matches("streaming"));
  expect(
    await status(fixture.command({ action: "skip", expectCurrent: token })),
  ).toBe(200);
  expect(
    await status(fixture.command({ action: "skip", expectCurrent: token })),
  ).toBe(409);
});

test("two plays of the same media get distinct opaque tokens that follow the entry", async () => {
  fixture = webFixture();
  await fixture.seed();
  actorEvent();
  const before = await snapshot();
  const first = before.current?.token;
  const second = before.queue[0]?.token;
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(first).not.toBe(second);
  for (const token of [first, second])
    expect(token).toMatch(/^[0-9a-f-]{36}$/u);
  expect(JSON.stringify(before)).not.toMatch(/\/media\/|arrival\.mkv/u);
  expect(
    await status(fixture.command({ action: "skip", expectCurrent: first })),
  ).toBe(200);
  await waitFor(fixture.actor, (state) => state.matches("streaming"));
  // The queued entry keeps its token through dequeue and resolution.
  const after = await snapshot();
  expect(after.current?.token).toBe(second);
});

test("time to playback is observed once for an immediate start and never for a queued item", async () => {
  fixture = webFixture();
  const first = await fixture.handler(
    fixture.command({
      action: "play",
      placement: "queue",
      transport: "watch",
      selection: { kind: "library", id: await libraryId("Arrival") },
    }),
  );
  expect(CommandResultSchema.parse(await first.json()).position).toBe(0);
  await waitFor(fixture.actor, (state) => state.matches("streaming"));
  await vi.waitFor(async () => {
    expect(await timeToPlaybackSamples()).toBe(1);
  });
  const queued = await fixture.handler(
    fixture.command({
      action: "play",
      placement: "queue",
      transport: "watch",
      selection: { kind: "library", id: await libraryId("Whiplash") },
    }),
  );
  expect(CommandResultSchema.parse(await queued.json()).position).toBe(1);
  expect(await status(fixture.command({ action: "skip" }))).toBe(200);
  await waitFor(
    fixture.actor,
    (state) =>
      state.matches("streaming") &&
      state.context.current?.source.kind === "file" &&
      state.context.current.source.path.includes("whiplash"),
  );
  expect(await status(fixture.command({ action: "pause" }))).toBe(200);
  expect(await status(fixture.command({ action: "resume" }))).toBe(200);
  await waitFor(fixture.actor, (state) => state.matches("streaming"));
  expect(await timeToPlaybackSamples()).toBe(1);
  const metric = await timeToPlaybackMetric();
  expect(
    metric?.values.find((value) => value.labels["transport"] !== undefined)
      ?.labels,
  ).toMatchObject({ transport: "watch" });
});

/** The keys every command from a page loaded before they were dropped still carries. */
function previousClientBase(revision: string | null) {
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    revision,
    // A legacy room: the previous client sends no slot there.
    playbackChannel: null,
    selectionVersion: null,
    slotRevisions: {},
    targeting: "explicit",
  };
}

/** Posts `body` exactly as given, with the signed-in viewer's cookie and CSRF token. */
async function postExact(body: Record<string, unknown>): Promise<number> {
  return await status(
    new Request("http://127.0.0.1:8080/api/commands", {
      method: "POST",
      headers: fixture.command({}).headers,
      body: JSON.stringify(body),
    }),
  );
}

test("a page loaded before the targeting fields were dropped can still play, skip and remove", async () => {
  fixture = webFixture();
  for (const title of ["Arrival", "Whiplash", "Spirited Away"])
    expect(
      await postExact({
        ...previousClientBase(null),
        action: "play",
        selection: { kind: "library", id: await libraryId(title) },
        placement: "queue",
        transport: "watch",
      }),
      title,
    ).toBe(200);
  await waitFor(fixture.actor, (state) => state.matches("streaming"));
  const player = await snapshot();
  expect(player.queue).toHaveLength(2);
  expect(
    await postExact({
      ...previousClientBase(player.revision),
      action: "remove",
      position: 1,
    }),
  ).toBe(200);
  expect(
    await postExact({
      ...previousClientBase(player.revision),
      action: "skip",
      ...(player.current?.token === undefined
        ? {}
        : { expectCurrent: player.current.token }),
    }),
  ).toBe(200);
  await waitFor(
    fixture.actor,
    (state) =>
      state.matches("streaming") &&
      state.context.current?.source.kind === "file" &&
      state.context.current.source.path.includes("spirited-away"),
  );
});
