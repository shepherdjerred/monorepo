import { afterEach, expect, test, vi } from "vitest";
import { fixtureMusic, ALBUM } from "#music-fixture";
import { albumSelection, recordLoads } from "./web-fixture-music.ts";
import { webFixture, GUILD, CHANNEL } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
afterEach(() => {
  fixture?.playback.deps.music?.loads.close();
  fixture?.close();
  fixture = undefined;
  vi.restoreAllMocks();
});
const URL_TO_LOAD = "https://www.youtube.com/playlist?list=PLfixture";
const ITEMS = [
  { title: "First", url: "https://www.youtube.com/watch?v=h5EofwRzit0" },
];
async function settle(f: ReturnType<typeof webFixture>, id: string) {
  const loads = f.playback.deps.music?.loads;
  if (loads === undefined) throw new Error("Missing fixture music");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const progress = loads.read(id, f.session.identity.userId, GUILD);
    if (progress.state !== "loading") return progress;
  }
  throw new Error("Load did not settle");
}
async function startLoad(f: ReturnType<typeof webFixture>) {
  const ids = recordLoads(f.playback.deps.music);
  const response = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: { kind: "url", url: URL_TO_LOAD },
    }),
  );
  expect(response.status).toBe(200);
  const [id] = ids;
  if (id === undefined) throw new Error("No playlist load started");
  return id;
}
test.each(["voice", "membership", "stop"] as const)(
  "late playlist metadata cannot enqueue after %s",
  async (boundary) => {
    const pending = Promise.withResolvers<typeof ITEMS>();
    const f = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
      music: fixtureMusic(),
      musicEnabled: true,
      expandPlaylist: () => pending.promise,
    });
    fixture = f;
    if (boundary === "stop") await f.seed();
    const id = await startLoad(f);
    switch (boundary) {
      case "voice":
        f.setChannel(null);
        break;
      case "membership":
        f.setMember(false);
        break;
      case "stop": {
        const response = await f.handler(f.command({ action: "stop" }));
        expect(response.status).toBe(200);
        break;
      }
    }
    pending.resolve(ITEMS);
    const progress = await settle(f, id);
    expect(["failed", "cancelled"]).toContain(progress.state);
    expect(f.events.filter((event) => event.type === "ADD_BATCH")).toEqual([]);
    const queued = f.actor
      .getSnapshot()
      .context.queue.map((item) =>
        item.source.kind === "url" ? item.source.url : item.source.kind,
      );
    expect(queued).toEqual([]);
    expect(f.allocations()).toBe(0);
  },
);

test("a playlist that finishes loading after another request queues behind it", async () => {
  const pending = Promise.withResolvers<typeof ITEMS>();
  const f = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
    music: fixtureMusic(),
    musicEnabled: true,
    expandPlaylist: () => pending.promise,
  });
  fixture = f;
  await f.seed();
  const id = await startLoad(f);
  const other = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: {
        kind: "url",
        url: "https://www.youtube.com/watch?v=oldqueued01",
      },
    }),
  );
  expect(other.status).toBe(200);
  pending.resolve(ITEMS);
  const progress = await settle(f, id);
  expect(progress.state).toBe("ready");
  const queued = f.actor
    .getSnapshot()
    .context.queue.map((item) =>
      item.source.kind === "url" ? item.source.url : item.source.kind,
    );
  expect(queued).toEqual([
    "https://www.youtube.com/watch?v=oldqueued01",
    "https://www.youtube.com/watch?v=h5EofwRzit0",
  ]);
});

test.each(["queue", "next", "now"] as const)(
  "album %s preserves order around existing queued media",
  async (placement) => {
    const f = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
      music: fixtureMusic(),
      musicEnabled: true,
    });
    fixture = f;
    await f.seed();
    const previous = await f.handler(
      f.command({
        action: "play",
        placement: "queue",
        selection: {
          kind: "url",
          url: "https://www.youtube.com/watch?v=oldqueued01",
        },
      }),
    );
    expect(previous.status).toBe(200);
    const id = await albumSelection(f, { album: ALBUM, guildId: GUILD });
    const result = await f.handler(
      f.command({
        action: "play",
        placement,
        transport: "listen",
        selection: { kind: "music", id },
      }),
    );
    expect(result.status).toBe(200);
    const view = f.actor.getSnapshot().context;
    const queued = view.queue.map((item) => item.source.music?.title ?? "old");
    expect(queued).toEqual(
      placement === "queue"
        ? ["old", "Get Lucky", "Instant Crush"]
        : placement === "next"
          ? ["Get Lucky", "Instant Crush", "old"]
          : ["Instant Crush", "old"],
    );
    if (placement === "now")
      expect(view.current?.source.music?.title).toBe("Get Lucky");
    expect(
      f.playback.deps.bot.webVoiceChannel(GUILD, f.session.identity.userId)?.id,
    ).toBe(CHANNEL);
  },
);
