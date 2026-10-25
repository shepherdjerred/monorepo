import { afterEach, expect, test } from "vitest";
import {
  MusicAlbumSchema,
  QueueLoadSchema,
} from "@shepherdjerred/streambot/music/contracts.ts";
import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { fixtureMusic, ALBUM } from "#music-fixture";
import { webFixture, GUILD, CHANNEL } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
afterEach(() => {
  fixture?.playback.deps.music?.loads.close();
  fixture?.close();
  fixture = undefined;
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
  const response = await f.handler(
    f.command({
      action: "play",
      placement: "queue",
      selection: { kind: "url", url: URL_TO_LOAD },
    }),
  );
  expect(response.status).toBe(200);
  const result = CommandResultSchema.parse(await response.json());
  if (result.loadId === undefined) throw new Error("Missing load ID");
  return result.loadId;
}
test.each(["cancel", "voice", "slot", "membership", "stop", "queue"] as const)(
  "late playlist metadata cannot enqueue after %s",
  async (boundary) => {
    const pending = Promise.withResolvers<typeof ITEMS>();
    const f = webFixture("http://127.0.0.1:8080", "/nonexistent", false, {
      music: fixtureMusic(),
      musicEnabled: true,
      expandPlaylist: () => pending.promise,
    });
    fixture = f;
    if (boundary === "slot") f.enableNumbered(2);
    if (boundary === "stop" || boundary === "queue") await f.seed();
    const id = await startLoad(f);
    switch (boundary) {
      case "cancel": {
        const response = await f.handler(
          new Request(
            "http://127.0.0.1:8080/api/music/load?guildId=" +
              GUILD +
              "&id=" +
              id,
            { method: "POST", headers: f.command({}).headers },
          ),
        );
        expect(QueueLoadSchema.parse(await response.json()).state).toBe(
          "cancelled",
        );
        break;
      }
      case "voice":
        f.setChannel(null);
        break;
      case "slot":
        f.enableNumbered(3);
        break;
      case "membership":
        f.setMember(false);
        break;
      case "stop": {
        const response = await f.handler(f.command({ action: "stop" }));
        expect(response.status).toBe(200);
        break;
      }
      case "queue": {
        const response = await f.handler(
          f.command({
            action: "play",
            placement: "queue",
            selection: {
              kind: "url",
              url: "https://www.youtube.com/watch?v=oldqueued01",
            },
          }),
        );
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
    expect(queued).toEqual(
      boundary === "queue"
        ? ["https://www.youtube.com/watch?v=oldqueued01"]
        : [],
    );
    expect(f.allocations()).toBe(0);
  },
);

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
    const response = await f.handler(
      new Request(
        "http://127.0.0.1:8080/api/music/album?guildId=" +
          GUILD +
          "&album=" +
          ALBUM,
        { headers: { cookie: f.cookie } },
      ),
    );
    const album = MusicAlbumSchema.parse(await response.json());
    const result = await f.handler(
      f.command({
        action: "play",
        placement,
        selection: { kind: "music", id: album.selectionId },
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
