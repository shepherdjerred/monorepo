import { describe, expect, test } from "bun:test";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  PlaybackCommandBoundaryError,
  PlaybackCommandService,
} from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

const USER = UserIdSchema.parse("100000000000000001");
const OTHER = UserIdSchema.parse("100000000000000002");
const ADMIN = UserIdSchema.parse("100000000000000003");

function createService(overrides: Partial<PlaybackView> = {}) {
  const events: PlaybackEvent[] = [];
  const resolvedKinds: string[] = [];
  const seeks: number[] = [];
  const view: PlaybackView = {
    state: "streaming",
    current: {
      title: "Current",
      requesterId: USER,
      chapters: [],
      kind: "file",
      sourceId: "file:/current.mkv",
      durationSeconds: 600,
    },
    queue: [],
    loop: "off",
    volume: 100,
    positionSeconds: 90,
    ...overrides,
  };
  const config = loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "userbot",
    ADMIN_IDS: String(ADMIN),
    VIDEOS_DIR: "/videos",
  });
  const service = new PlaybackCommandService({
    config,
    dispatch: (event) => events.push(event),
    view: () => view,
    library: () => [
      {
        title: "Local Movie",
        path: "/movies/local.mkv",
        relativePath: "local.mkv",
        library: "movies",
      },
    ],
    setVolume: () => Promise.resolve(true),
    seek: (seconds) => {
      seeks.push(seconds);
      return Promise.resolve(true);
    },
    resolvePlaySource: (source) => {
      resolvedKinds.push(source.kind);
      return Promise.resolve({
        title: "YouTube result",
        ffmpegInput: "https://media.invalid/video",
        chapters: [],
      });
    },
  });
  return { service, events, resolvedKinds, seeks };
}

describe("PlaybackCommandService", () => {
  test("auto is local-first, local never falls through, and youtube bypasses local", async () => {
    const auto = createService();
    await auto.service.play({
      query: "Local Movie",
      source: "auto",
      placement: "queue",
      userId: USER,
    });
    expect(auto.events[0]).toMatchObject({
      type: "ADD",
      source: { kind: "file" },
    });
    expect(auto.resolvedKinds).toEqual([]);

    const local = createService();
    await expect(
      local.service.play({
        query: "Missing Movie",
        source: "local",
        placement: "queue",
        userId: USER,
      }),
    ).rejects.toBeInstanceOf(PlaybackCommandBoundaryError);
    expect(local.resolvedKinds).toEqual([]);

    const youtube = createService();
    await youtube.service.play({
      query: "Local Movie",
      source: "youtube",
      placement: "next",
      userId: USER,
    });
    expect(youtube.resolvedKinds).toEqual(["search"]);
    expect(youtube.events[0]).toMatchObject({
      type: "ADD_NEXT",
      source: { kind: "search" },
    });
  });

  test("rejects arbitrary URLs at the voice boundary", async () => {
    const { service, events } = createService();
    await expect(
      service.play({
        query: "https://youtube.com/watch?v=nope",
        source: "youtube",
        placement: "queue",
        userId: USER,
      }),
    ).rejects.toThrow("title instead of a URL");
    expect(events).toEqual([]);
  });

  test("keeps requester and admin authorization authoritative", () => {
    const { service, events } = createService();
    expect(() => service.skip(OTHER)).toThrow("requester or an admin");
    expect(service.skip(USER)).toEqual({
      outcome: "skipped",
      message: "Skipped.",
    });
    expect(() => service.stop(USER)).toThrow("Only an admin");
    expect(service.stop(ADMIN)).toEqual({
      outcome: "stopped",
      message: "Stopped and cleared the queue.",
    });
    expect(events.map((event) => event.type)).toEqual(["SKIP", "STOP"]);
  });

  test("supports relative seek against the live position", async () => {
    const { service, seeks } = createService();
    await expect(service.seek(USER, -30, true)).resolves.toEqual({
      outcome: "seeked",
      message: "Seeked to 1:00.",
    });
    await expect(service.seek(USER, 150, false)).resolves.toEqual({
      outcome: "seeked",
      message: "Seeked to 2:30.",
    });
    expect(seeks).toEqual([60, 150]);
  });

  test("never dispatches a play after its voice transaction expires", async () => {
    const events: PlaybackEvent[] = [];
    const config = loadConfig({
      BOT_TOKEN: "bot",
      USER_TOKENS: "userbot",
      VIDEOS_DIR: "/videos",
    });
    const controller = new AbortController();
    const service = new PlaybackCommandService({
      config,
      dispatch: (event) => events.push(event),
      view: () => ({
        state: "streaming",
        current: null,
        queue: [],
        loop: "off",
        volume: 100,
        positionSeconds: null,
      }),
      library: () => [],
      setVolume: () => Promise.resolve(true),
      seek: () => Promise.resolve(true),
      resolvePlaySource: async () => {
        controller.abort();
        return {
          title: "late",
          ffmpegInput: "https://media.invalid/late",
          chapters: [],
        };
      },
    });
    await expect(
      service.play({
        query: "late result",
        source: "youtube",
        placement: "queue",
        userId: USER,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
    expect(events).toEqual([]);
  });
});
