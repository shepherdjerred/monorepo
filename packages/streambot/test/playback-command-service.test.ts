import { describe, expect, test } from "vitest";
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
  const announcements: string[] = [];
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
    announce: (message) => {
      announcements.push(message);
      return Promise.resolve();
    },
  });
  return { service, events, resolvedKinds, seeks, announcements };
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

  test("blocked sources shame publicly and deny tersely by voice", async () => {
    const { service, events, announcements } = createService();
    await expect(
      service.play({
        query: "porn compilation",
        source: "youtube",
        placement: "queue",
        userId: USER,
      }),
    ).rejects.toThrow("Nope. That's not allowed.");
    // Same public shaming as slash; the spoken denial never repeats the block reason.
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toContain(`<@${USER}>`);
    expect(events).toEqual([]);
  });

  test("voice queue reads carry no requester mentions", () => {
    const { service } = createService({
      queue: [
        {
          title: "Queued Movie",
          requesterId: OTHER,
          chapters: [],
          kind: "file",
          sourceId: "file:/queued.mkv",
          durationSeconds: 60,
        },
      ],
    });
    // These strings are sent to OpenAI as tool results; Discord user IDs stay in-process.
    expect(service.getQueue()).toContain("Queued Movie");
    expect(service.getQueue()).not.toContain("<@");
    expect(service.getNowPlaying()).toContain("Current");
    expect(service.getNowPlaying()).not.toContain("<@");
  });
});

describe("PlaybackCommandService queue and chapter surface", () => {
  test("queue management mirrors slash permissions and bounds", () => {
    const queueItem = {
      title: "Queued Movie",
      requesterId: USER,
      chapters: [],
      kind: "file" as const,
      sourceId: "file:/queued.mkv",
      durationSeconds: 60,
    };
    const { service, events } = createService({ queue: [queueItem] });
    expect(() => service.remove(OTHER, 1)).toThrow("requester or an admin");
    expect(() => service.remove(USER, 5)).toThrow("no queue item");
    expect(service.remove(ADMIN, 1)).toEqual({
      outcome: "removed",
      message: "Removed Queued Movie.",
    });
    expect(() => service.clear(USER)).toThrow("Only an admin");
    expect(service.clear(ADMIN).outcome).toBe("cleared");
    expect(() => service.move(1, 9)).toThrow("positions don't exist");
    expect(service.move(1, 1)).toEqual({
      outcome: "moved",
      message: "Moved Queued Movie to position 1.",
    });
    expect(events.map((event) => event.type)).toEqual([
      "REMOVE",
      "CLEAR",
      "MOVE",
    ]);
  });

  test("chapter jumps honor requester control, bounds, and relative targets", async () => {
    const chapters = [
      { index: 1, title: "Intro", startSeconds: 0, endSeconds: 60 },
      { index: 2, title: "Middle", startSeconds: 60, endSeconds: 120 },
      { index: 3, title: "End", startSeconds: 120, endSeconds: null },
    ];
    const { service, seeks } = createService({
      current: {
        title: "Current",
        requesterId: USER,
        chapters,
        kind: "file",
        sourceId: "file:/current.mkv",
        durationSeconds: 600,
      },
      positionSeconds: 90,
    });
    await expect(service.jumpToChapter(OTHER, 1)).rejects.toThrow(
      "requester or an admin",
    );
    await expect(service.jumpToChapter(USER, 9)).rejects.toThrow(
      "no chapter 9",
    );
    // Position 90 s is inside chapter 2, so next is 3 and previous is 1.
    await expect(service.jumpToChapter(USER, "next")).resolves.toMatchObject({
      outcome: "chapter-jumped",
      message: "Chapter 3: End.",
    });
    await expect(
      service.jumpToChapter(USER, "previous"),
    ).resolves.toMatchObject({ message: "Chapter 1: Intro." });
    await expect(service.jumpToChapter(USER, 2)).resolves.toMatchObject({
      message: "Chapter 2: Middle.",
    });
    expect(seeks).toEqual([120, 0, 60]);
  });

  test("subtitles off dispatches a positioned change for a controllable item", () => {
    const { service, events } = createService();
    expect(() => service.subtitlesOff(OTHER)).toThrow("requester or an admin");
    expect(service.subtitlesOff(USER).outcome).toBe("subtitles-off");
    expect(events[0]).toEqual({
      type: "CHANGE_SUBTITLES",
      subtitles: { trackRef: { kind: "off" } },
      positionSeconds: 90,
    });
  });

  test("library search is bounded and mention-free", () => {
    const { service } = createService();
    expect(service.searchLibraryTitles("local", 5)).toBe("Local Movie");
    expect(service.searchLibraryTitles("nothing-matches", 5)).toContain(
      "Nothing in the library",
    );
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
      announce: () => Promise.resolve(),
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
