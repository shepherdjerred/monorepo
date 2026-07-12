import { describe, expect, test } from "bun:test";
import {
  CommandHandler,
  type CommandHandlerDeps,
  type CommandInteraction,
} from "@shepherdjerred/streambot/discord/command-handler.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import {
  helpText,
  listPages,
  sourcesPages,
  type PaginatedPages,
} from "@shepherdjerred/streambot/discord/help-text.ts";
import { commandJson } from "@shepherdjerred/streambot/discord/commands.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import {
  UserIdSchema,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { BlockedSourceError } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { SubtitleCandidate } from "@shepherdjerred/streambot/sources/subtitles.ts";

const ADMIN = "160509172704739328";
const REQUESTER = "100000000000000001";
const OTHER = "200000000000000002";
const GUILD = "208425771172102144";
const CHANNEL = "692223827475824650";

function uid(value: string): UserId {
  return UserIdSchema.parse(value);
}

function makeConfig(adminIds: string[]) {
  return loadConfig({
    BOT_TOKEN: "bot-token",
    TOKEN: "user-token",
    GUILD_ID: GUILD,
    COMMAND_CHANNEL_ID: CHANNEL,
    VIDEO_CHANNEL_ID: CHANNEL,
    ADMIN_IDS: adminIds.join(","),
    VIDEOS_DIR: "/tmp/videos",
  });
}

const RESOLVED_STUB: ResolvedSource = {
  title: "resolved",
  ffmpegInput: "resolved://input",
  chapters: [],
};

const EMPTY_VIEW: PlaybackView = {
  state: "idle",
  current: null,
  queue: [],
  loop: "off",
  volume: 100,
  positionSeconds: null,
};

type Harness = {
  handler: CommandHandler;
  events: PlaybackEvent[];
  announces: string[];
};

function makeHandler(over: {
  adminIds?: string[];
  view?: PlaybackView;
  library?: LibraryEntry[];
  volumeApplied?: boolean;
  seekApplied?: boolean;
  playlistItems?: { url: string; title: string }[];
  sources?: string[];
  resolvedSource?: ResolvedSource;
  resolvePlayError?: Error;
  subtitleCandidates?: SubtitleCandidate[];
  subtitleMenuAlreadyPending?: boolean;
}): Harness & { seeks: number[]; subtitleMenuPending: () => boolean } {
  const events: PlaybackEvent[] = [];
  const announces: string[] = [];
  const seeks: number[] = [];
  let subtitleMenuPending = over.subtitleMenuAlreadyPending ?? false;
  const deps: CommandHandlerDeps = {
    config: makeConfig(over.adminIds ?? []),
    dispatch: (event) => events.push(event),
    view: () => over.view ?? EMPTY_VIEW,
    library: () => over.library ?? [],
    setVolume: () => Promise.resolve(over.volumeApplied ?? true),
    seek: (seconds) => {
      seeks.push(seconds);
      return Promise.resolve(over.seekApplied ?? true);
    },
    expandPlaylist: () => Promise.resolve(over.playlistItems ?? []),
    listSources: () => Promise.resolve(over.sources ?? []),
    resolvePlaySource: () =>
      over.resolvePlayError === undefined
        ? Promise.resolve(over.resolvedSource ?? RESOLVED_STUB)
        : Promise.reject(over.resolvePlayError),
    announce: (message) => {
      announces.push(message);
      return Promise.resolve();
    },
    listSubtitleCandidates: () =>
      Promise.resolve(over.subtitleCandidates ?? []),
    hasPendingSubtitleMenu: () => subtitleMenuPending,
    claimSubtitleMenu: () => {
      if (subtitleMenuPending) return false;
      subtitleMenuPending = true;
      return true;
    },
    releaseSubtitleMenu: () => {
      subtitleMenuPending = false;
    },
  };
  return {
    handler: new CommandHandler(deps),
    events,
    announces,
    seeks,
    subtitleMenuPending: () => subtitleMenuPending,
  };
}

type FakeOpts = {
  userId?: string;
  sub: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  /** What `replySelectMenu` resolves with — the user's (fake) pick, or null to simulate a timeout. */
  subtitleMenuPick?: string | null;
};

function fakeInteraction(opts: FakeOpts): {
  interaction: CommandInteraction;
  replies: string[];
  edits: string[];
  paginated: PaginatedPages[];
  selectMenuCandidates: (readonly SubtitleCandidate[])[];
  state: { deferred: boolean };
} {
  const replies: string[] = [];
  const edits: string[] = [];
  const paginated: PaginatedPages[] = [];
  const selectMenuCandidates: (readonly SubtitleCandidate[])[] = [];
  const state = { deferred: false };
  const interaction: CommandInteraction = {
    userId: uid(opts.userId ?? REQUESTER),
    subcommand: () => opts.sub,
    getString: (name) => opts.strings?.[name] ?? null,
    getStringRequired: (name) => {
      const value = opts.strings?.[name];
      if (value === undefined) {
        throw new Error(`missing required string: ${name}`);
      }
      return value;
    },
    getIntegerRequired: (name) => {
      const value = opts.integers?.[name];
      if (value === undefined) {
        throw new Error(`missing required integer: ${name}`);
      }
      return value;
    },
    reply: (content) => {
      replies.push(content);
      return Promise.resolve();
    },
    defer: () => {
      state.deferred = true;
      return Promise.resolve();
    },
    editReply: (content) => {
      edits.push(content);
      return Promise.resolve();
    },
    replyPaginated: (payload) => {
      paginated.push(payload);
      return Promise.resolve();
    },
    replySelectMenu: (candidates) => {
      selectMenuCandidates.push(candidates);
      return Promise.resolve(opts.subtitleMenuPick ?? null);
    },
  };
  return {
    interaction,
    replies,
    edits,
    paginated,
    selectMenuCandidates,
    state,
  };
}

function viewWithCurrent(requesterId: string): PlaybackView {
  return {
    ...EMPTY_VIEW,
    state: "streaming",
    current: {
      title: "Current Song",
      requesterId: uid(requesterId),
      chapters: [],
    },
  };
}

describe("CommandHandler routing + acks", () => {
  test("play pre-resolves a search source (defer+edit) and acks", async () => {
    const h = makeHandler({});
    const { interaction, edits, state } = fakeInteraction({
      sub: "play",
      strings: { query: "never gonna give you up" },
    });
    await h.handler.run(interaction);
    expect(state.deferred).toBe(true);
    expect(h.events).toEqual([
      {
        type: "ADD",
        source: { kind: "search", query: "never gonna give you up" },
        requesterId: uid(REQUESTER),
        preResolved: RESOLVED_STUB,
      },
    ]);
    expect(edits[0]).toStartWith("Queued: **never gonna give you up**");
    expect(edits[0]).toContain("Tip: ");
  });

  test("playnext unshifts (ADD_NEXT) and acks", async () => {
    const h = makeHandler({});
    const { interaction, edits } = fakeInteraction({
      sub: "playnext",
      strings: { query: "song" },
    });
    await h.handler.run(interaction);
    expect(h.events[0]?.type).toBe("ADD_NEXT");
    expect(edits[0]).toStartWith("Up next: **song**");
    expect(edits[0]).toContain("Tip: ");
  });

  test("play resolves a library file source without deferring (fast path)", async () => {
    const h = makeHandler({
      library: [
        {
          title: "Movie",
          path: "/videos/Movie.mkv",
          relativePath: "Movie.mkv",
          library: "movies",
        },
      ],
    });
    const { interaction, replies, state } = fakeInteraction({
      sub: "play",
      strings: { query: "Movie" },
    });
    await h.handler.run(interaction);
    expect(state.deferred).toBe(false);
    expect(h.events).toEqual([
      {
        type: "ADD",
        source: { kind: "file", path: "/videos/Movie.mkv", title: "Movie" },
        requesterId: uid(REQUESTER),
      },
    ]);
    expect(replies[0]).toStartWith("Queued: **Movie**");
  });

  test("play surfaces a specific error for an unsupported site and queues nothing", async () => {
    const h = makeHandler({
      resolvePlayError: new Error(
        "yt-dlp exited with code 1: Unsupported URL: https://nope.example/x",
      ),
    });
    const { interaction, edits, state } = fakeInteraction({
      sub: "play",
      strings: { query: "https://nope.example/x" },
    });
    await h.handler.run(interaction);
    expect(state.deferred).toBe(true);
    expect(h.events).toHaveLength(0);
    expect(edits[0]).toContain("That site isn't supported");
  });

  test("play surfaces a specific error for an unavailable video and queues nothing", async () => {
    const h = makeHandler({
      resolvePlayError: new Error(
        "yt-dlp exited with code 1: ERROR: [youtube] abc123: Video unavailable",
      ),
    });
    const { interaction, edits } = fakeInteraction({
      sub: "play",
      strings: { query: "https://www.youtube.com/watch?v=abc123" },
    });
    await h.handler.run(interaction);
    expect(h.events).toHaveLength(0);
    expect(edits[0]).toContain("unavailable, private, or has been removed");
  });

  test("play surfaces a no-results error for a garbage search and queues nothing", async () => {
    const h = makeHandler({
      resolvePlayError: new Error(
        "yt-dlp exited with code 1: ERROR: [youtube:search] query: No videos found",
      ),
    });
    const { interaction, edits } = fakeInteraction({
      sub: "play",
      strings: { query: "asdkjfhaslkdjfhalskdjfh" },
    });
    await h.handler.run(interaction);
    expect(h.events).toHaveLength(0);
    expect(edits[0]).toBe("No results found for that search.");
  });

  test("play falls back to a generic (trimmed) error for unrecognized yt-dlp failures", async () => {
    const h = makeHandler({
      resolvePlayError: new Error(
        "could not parse yt-dlp output: unexpected token",
      ),
    });
    const { interaction, edits } = fakeInteraction({
      sub: "play",
      strings: { query: "https://example.com/video" },
    });
    await h.handler.run(interaction);
    expect(h.events).toHaveLength(0);
    expect(edits[0]).toStartWith("Couldn't queue that:");
  });

  test("play still shames+blocks when yt-dlp resolves to a blocked domain", async () => {
    const h = makeHandler({
      resolvePlayError: new BlockedSourceError("blocked.example"),
    });
    const { interaction, edits } = fakeInteraction({
      sub: "play",
      strings: { query: "https://bit.ly/redirect" },
    });
    await h.handler.run(interaction);
    expect(h.events).toHaveLength(0);
    expect(edits[0]).toBe("🚫 Nope.");
    expect(h.announces).toHaveLength(1);
  });

  test("unknown subcommand replies politely, dispatches nothing", async () => {
    const h = makeHandler({});
    const { interaction, replies } = fakeInteraction({ sub: "bogus" });
    await h.handler.run(interaction);
    expect(h.events).toHaveLength(0);
    expect(replies[0]).toBe("Unknown command.");
  });

  test("queue + nowplaying render the current view", async () => {
    const h = makeHandler({ view: viewWithCurrent(REQUESTER) });
    const q = fakeInteraction({ sub: "queue" });
    await h.handler.run(q.interaction);
    expect(q.replies[0]).toContain("**Now:** Current Song");

    const np = fakeInteraction({ sub: "nowplaying" });
    await h.handler.run(np.interaction);
    expect(np.replies[0]).toContain("**Now playing:** Current Song");
  });

  test("nowplaying reports nothing playing when idle", async () => {
    const h = makeHandler({ view: EMPTY_VIEW });
    const { interaction, replies } = fakeInteraction({ sub: "nowplaying" });
    await h.handler.run(interaction);
    expect(replies[0]).toBe("Nothing is playing.");
  });

  test("nowplaying omits the position line when position is null", async () => {
    const h = makeHandler({ view: viewWithCurrent(REQUESTER) });
    const { interaction, replies } = fakeInteraction({ sub: "nowplaying" });
    await h.handler.run(interaction);
    expect(replies[0]).not.toContain("Position:");
  });

  test("nowplaying renders position alone when there are no chapters", async () => {
    const view: PlaybackView = {
      ...viewWithCurrent(REQUESTER),
      positionSeconds: 95,
    };
    const h = makeHandler({ view });
    const { interaction, replies } = fakeInteraction({ sub: "nowplaying" });
    await h.handler.run(interaction);
    expect(replies[0]).toContain("**Position:** 1:35");
    expect(replies[0]).not.toContain("Chapter");
  });

  test("nowplaying renders position + current chapter when both are known", async () => {
    const view: PlaybackView = {
      ...viewWithChapters(REQUESTER),
      positionSeconds: 200,
    };
    const h = makeHandler({ view });
    const { interaction, replies } = fakeInteraction({ sub: "nowplaying" });
    await h.handler.run(interaction);
    expect(replies[0]).toContain("**Position:** 3:20 — Chapter 2: The Heist");
  });

  test("nowplaying skips the chapter clause when position is before the first chapter", async () => {
    const view: PlaybackView = {
      ...viewWithChapters(REQUESTER),
      current: {
        title: "Current Movie",
        requesterId: uid(REQUESTER),
        chapters: [
          { index: 1, title: "Intro", startSeconds: 30, endSeconds: 90 },
        ],
      },
      positionSeconds: 10,
    };
    const h = makeHandler({ view });
    const { interaction, replies } = fakeInteraction({ sub: "nowplaying" });
    await h.handler.run(interaction);
    expect(replies[0]).toContain("**Position:** 0:10");
    expect(replies[0]).not.toContain("Chapter");
  });
});

describe("CommandHandler adult-source blocking", () => {
  test("a blocked url is shamed publicly and never queued", async () => {
    const h = makeHandler({});
    const { interaction, replies } = fakeInteraction({
      sub: "play",
      strings: { query: "https://pornhub.com/view?id=1" },
    });
    await h.handler.run(interaction);
    expect(h.events).toHaveLength(0);
    expect(replies[0]).toBe("🚫 Nope.");
    expect(h.announces).toHaveLength(1);
    expect(h.announces[0]).toContain(`<@${REQUESTER}>`);
  });
});

describe("CommandHandler playlist expansion", () => {
  test("a playlist url defers, enqueues each item, and edits the ack", async () => {
    const h = makeHandler({
      playlistItems: [
        { url: "https://youtube.com/watch?v=1", title: "one" },
        { url: "https://youtube.com/watch?v=2", title: "two" },
      ],
    });
    const { interaction, edits, state } = fakeInteraction({
      sub: "play",
      strings: { query: "https://youtube.com/playlist?list=PL123" },
    });
    await h.handler.run(interaction);
    expect(state.deferred).toBe(true);
    expect(h.events).toHaveLength(2);
    expect(h.events.every((event) => event.type === "ADD")).toBe(true);
    expect(edits[0]).toStartWith("Queued 2 item(s) from the playlist.");
    expect(edits[0]).toContain("Tip: ");
  });
});

describe("CommandHandler permissions", () => {
  test("skip is denied for a non-requester non-admin", async () => {
    const h = makeHandler({ view: viewWithCurrent(OTHER) });
    const { interaction, replies } = fakeInteraction({
      sub: "skip",
      userId: REQUESTER,
    });
    await h.handler.run(interaction);
    expect(h.events).toHaveLength(0);
    expect(replies[0]).toContain("Only the requester or an admin");
  });

  test("skip is allowed for the original requester", async () => {
    const h = makeHandler({ view: viewWithCurrent(REQUESTER) });
    const { interaction } = fakeInteraction({ sub: "skip", userId: REQUESTER });
    await h.handler.run(interaction);
    expect(h.events).toEqual([{ type: "SKIP" }]);
  });

  test("skip is allowed for an admin who isn't the requester", async () => {
    const h = makeHandler({
      adminIds: [ADMIN],
      view: viewWithCurrent(OTHER),
    });
    const { interaction } = fakeInteraction({ sub: "skip", userId: ADMIN });
    await h.handler.run(interaction);
    expect(h.events).toEqual([{ type: "SKIP" }]);
  });

  test("stop and clear are admin-only", async () => {
    const denied = makeHandler({ adminIds: [ADMIN] });
    const stop = fakeInteraction({ sub: "stop", userId: REQUESTER });
    await denied.handler.run(stop.interaction);
    expect(denied.events).toHaveLength(0);
    expect(stop.replies[0]).toContain("Only an admin");

    const ok = makeHandler({ adminIds: [ADMIN] });
    const clear = fakeInteraction({ sub: "clear", userId: ADMIN });
    await ok.handler.run(clear.interaction);
    expect(ok.events).toEqual([{ type: "CLEAR" }]);
  });

  test("remove honours requester/admin and bounds-checks the index", async () => {
    const view: PlaybackView = {
      ...EMPTY_VIEW,
      queue: [{ title: "Item A", requesterId: uid(OTHER), chapters: [] }],
    };
    const denied = makeHandler({ view });
    const r1 = fakeInteraction({
      sub: "remove",
      userId: REQUESTER,
      integers: { index: 1 },
    });
    await denied.handler.run(r1.interaction);
    expect(denied.events).toHaveLength(0);
    expect(r1.replies[0]).toContain("Only the requester or an admin");

    const oob = makeHandler({ view });
    const r2 = fakeInteraction({
      sub: "remove",
      userId: OTHER,
      integers: { index: 9 },
    });
    await oob.handler.run(r2.interaction);
    expect(oob.events).toHaveLength(0);
    expect(r2.replies[0]).toBe("There's no item at position 9.");

    const ok = makeHandler({ view });
    const r3 = fakeInteraction({
      sub: "remove",
      userId: OTHER,
      integers: { index: 1 },
    });
    await ok.handler.run(r3.interaction);
    expect(ok.events).toEqual([{ type: "REMOVE", index: 1 }]);
    expect(r3.replies[0]).toBe("Removed **Item A**.");
  });
});

describe("CommandHandler queue edits + volume + loop", () => {
  test("move and shuffle dispatch and ack", async () => {
    const h = makeHandler({
      view: { ...EMPTY_VIEW, queue: [] },
    });
    const move = fakeInteraction({
      sub: "move",
      integers: { from: 1, to: 3 },
    });
    await h.handler.run(move.interaction);
    expect(h.events[0]).toEqual({ type: "MOVE", from: 1, to: 3 });
    expect(move.replies[0]).toBe("Moved item 1 → 3.");

    const shuffle = fakeInteraction({ sub: "shuffle" });
    await h.handler.run(shuffle.interaction);
    expect(h.events[1]).toEqual({ type: "SHUFFLE" });
  });

  test("volume applies live when playing, otherwise defers to next video", async () => {
    const live = makeHandler({ volumeApplied: true });
    const v1 = fakeInteraction({ sub: "volume", integers: { level: 40 } });
    await live.handler.run(v1.interaction);
    expect(live.events[0]).toEqual({ type: "SET_VOLUME", volume: 40 });
    expect(v1.replies[0]).toBe("🔊 Volume → 40%.");

    const idle = makeHandler({ volumeApplied: false });
    const v2 = fakeInteraction({ sub: "volume", integers: { level: 40 } });
    await idle.handler.run(v2.interaction);
    expect(v2.replies[0]).toBe("Volume set to 40% for the next video.");
  });

  test("loop accepts valid modes and rejects junk", async () => {
    const ok = makeHandler({});
    const good = fakeInteraction({ sub: "loop", strings: { mode: "queue" } });
    await ok.handler.run(good.interaction);
    expect(ok.events[0]).toEqual({ type: "SET_LOOP", mode: "queue" });
    expect(good.replies[0]).toBe("🔁 Loop: **queue**.");

    const bad = makeHandler({});
    const junk = fakeInteraction({
      sub: "loop",
      strings: { mode: "sideways" },
    });
    await bad.handler.run(junk.interaction);
    expect(bad.events).toHaveLength(0);
    expect(junk.replies[0]).toBe("Invalid loop mode.");
  });
});

describe("CommandHandler seek", () => {
  test("seek is rejected when nothing is playing", async () => {
    const h = makeHandler({ view: EMPTY_VIEW });
    const { interaction, replies } = fakeInteraction({
      sub: "seek",
      strings: { position: "1:30" },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toHaveLength(0);
    expect(replies[0]).toBe("Nothing is playing.");
  });

  test("seek is denied for a non-requester non-admin", async () => {
    const h = makeHandler({ view: viewWithCurrent(OTHER) });
    const { interaction, replies } = fakeInteraction({
      sub: "seek",
      userId: REQUESTER,
      strings: { position: "1:30" },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toHaveLength(0);
    expect(replies[0]).toContain("Only the requester or an admin");
  });

  test("seek parses the timestamp and acks for the requester", async () => {
    const h = makeHandler({ view: viewWithCurrent(REQUESTER) });
    const { interaction, replies } = fakeInteraction({
      sub: "seek",
      userId: REQUESTER,
      strings: { position: "1:30" },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toEqual([90]);
    expect(replies[0]).toBe("⏩ Seeked to 1:30.");
  });

  test("seek allows an admin who isn't the requester", async () => {
    const h = makeHandler({
      adminIds: [ADMIN],
      view: viewWithCurrent(OTHER),
    });
    const { interaction } = fakeInteraction({
      sub: "seek",
      userId: ADMIN,
      strings: { position: "90" },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toEqual([90]);
  });

  test("seek rejects an invalid timestamp", async () => {
    const h = makeHandler({ view: viewWithCurrent(REQUESTER) });
    const { interaction, replies } = fakeInteraction({
      sub: "seek",
      userId: REQUESTER,
      strings: { position: "abc" },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toHaveLength(0);
    expect(replies[0]).toBe("Invalid timestamp. Try 90, 1:30, or 1:02:03.");
  });
});

function viewWithChapters(requesterId: string): PlaybackView {
  return {
    ...EMPTY_VIEW,
    state: "streaming",
    current: {
      title: "Current Movie",
      requesterId: uid(requesterId),
      chapters: [
        { index: 1, title: "Intro", startSeconds: 0, endSeconds: 90 },
        { index: 2, title: "The Heist", startSeconds: 90, endSeconds: 3723 },
      ],
    },
  };
}

describe("CommandHandler chapters", () => {
  test("chapters lists the current video's chapters with timecodes", async () => {
    const h = makeHandler({ view: viewWithChapters(REQUESTER) });
    const { interaction, replies } = fakeInteraction({ sub: "chapters" });
    await h.handler.run(interaction);
    expect(replies[0]).toBe(
      "**Chapters for Current Movie:**\n1. `0:00` — Intro\n2. `1:30` — The Heist",
    );
  });

  test("chapters reports none when the current video has no chapters", async () => {
    const h = makeHandler({ view: viewWithCurrent(REQUESTER) });
    const { interaction, replies } = fakeInteraction({ sub: "chapters" });
    await h.handler.run(interaction);
    expect(replies[0]).toBe("No chapters for the current video.");
  });

  test("chapters reports nothing playing when idle", async () => {
    const h = makeHandler({ view: EMPTY_VIEW });
    const { interaction, replies } = fakeInteraction({ sub: "chapters" });
    await h.handler.run(interaction);
    expect(replies[0]).toBe("Nothing is playing.");
  });

  test("chapter seeks to the chapter's start and acks", async () => {
    const h = makeHandler({ view: viewWithChapters(REQUESTER) });
    const { interaction, replies } = fakeInteraction({
      sub: "chapter",
      userId: REQUESTER,
      integers: { number: 2 },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toEqual([90]);
    expect(replies[0]).toBe("⏩ Chapter 2: **The Heist** (1:30).");
  });

  test("chapter rejects an out-of-range number", async () => {
    const h = makeHandler({ view: viewWithChapters(REQUESTER) });
    const { interaction, replies } = fakeInteraction({
      sub: "chapter",
      userId: REQUESTER,
      integers: { number: 9 },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toHaveLength(0);
    expect(replies[0]).toBe("There's no chapter 9. This video has 2.");
  });

  test("chapter is denied for a non-requester non-admin", async () => {
    const h = makeHandler({ view: viewWithChapters(OTHER) });
    const { interaction, replies } = fakeInteraction({
      sub: "chapter",
      userId: REQUESTER,
      integers: { number: 1 },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toHaveLength(0);
    expect(replies[0]).toContain("Only the requester or an admin");
  });

  test("chapter reports nothing playing when idle", async () => {
    const h = makeHandler({ view: EMPTY_VIEW });
    const { interaction, replies } = fakeInteraction({
      sub: "chapter",
      integers: { number: 1 },
    });
    await h.handler.run(interaction);
    expect(h.seeks).toHaveLength(0);
    expect(replies[0]).toBe("Nothing is playing.");
  });
});

const SIDECAR_CANDIDATE: SubtitleCandidate = {
  kind: "sidecar",
  file: "Movie.en.srt",
  lang: "en",
  modifier: null,
};

describe("CommandHandler subtitles command (track picker)", () => {
  test("defers, lists candidates, presents the menu, and dispatches the pick", async () => {
    const h = makeHandler({
      view: { ...viewWithCurrent(REQUESTER), positionSeconds: 123 },
      subtitleCandidates: [SIDECAR_CANDIDATE],
    });
    const { interaction, edits, state, selectMenuCandidates } = fakeInteraction(
      {
        sub: "subtitles",
        userId: REQUESTER,
        subtitleMenuPick: "sidecar:Movie.en.srt",
      },
    );
    await h.handler.run(interaction);
    expect(state.deferred).toBe(true);
    expect(selectMenuCandidates).toEqual([[SIDECAR_CANDIDATE]]);
    expect(h.events).toEqual([
      {
        type: "CHANGE_SUBTITLES",
        subtitles: { trackRef: { kind: "sidecar", file: "Movie.en.srt" } },
        positionSeconds: 123,
      },
    ]);
    expect(edits.at(-1)).toContain(
      "Restarting with the selected subtitle track",
    );
    // Single-flight slot is released after a successful pick.
    expect(h.subtitleMenuPending()).toBe(false);
  });

  test("reports nothing playing when idle (no defer, no candidate lookup)", async () => {
    const h = makeHandler({ view: EMPTY_VIEW });
    const { interaction, replies, state } = fakeInteraction({
      sub: "subtitles",
    });
    await h.handler.run(interaction);
    expect(state.deferred).toBe(false);
    expect(h.events).toHaveLength(0);
    expect(replies[0]).toBe("Nothing is playing.");
  });

  test("denies a non-requester non-admin", async () => {
    const h = makeHandler({ view: viewWithCurrent(OTHER) });
    const { interaction, replies, state } = fakeInteraction({
      sub: "subtitles",
      userId: REQUESTER,
    });
    await h.handler.run(interaction);
    expect(state.deferred).toBe(false);
    expect(h.events).toHaveLength(0);
    expect(replies[0]).toContain("Only the requester or an admin");
  });

  test("replies immediately with no candidates found and skips the menu", async () => {
    const h = makeHandler({
      view: viewWithCurrent(REQUESTER),
      subtitleCandidates: [],
    });
    const { interaction, edits, selectMenuCandidates } = fakeInteraction({
      sub: "subtitles",
      userId: REQUESTER,
    });
    await h.handler.run(interaction);
    expect(selectMenuCandidates).toHaveLength(0);
    expect(edits).toEqual([
      "No subtitle tracks were found for the current video.",
    ]);
    expect(h.events).toHaveLength(0);
    expect(h.subtitleMenuPending()).toBe(false);
  });

  test("a timed-out pick (null) reports timeout and dispatches nothing", async () => {
    const h = makeHandler({
      view: viewWithCurrent(REQUESTER),
      subtitleCandidates: [SIDECAR_CANDIDATE],
    });
    const { interaction, edits } = fakeInteraction({
      sub: "subtitles",
      userId: REQUESTER,
      subtitleMenuPick: null,
    });
    await h.handler.run(interaction);
    expect(edits.at(-1)).toBe("Selection timed out.");
    expect(h.events).toHaveLength(0);
    expect(h.subtitleMenuPending()).toBe(false);
  });

  test("rejects a second concurrent picker for the same session", async () => {
    const h = makeHandler({
      view: viewWithCurrent(REQUESTER),
      subtitleCandidates: [SIDECAR_CANDIDATE],
      subtitleMenuAlreadyPending: true,
    });
    const { interaction, replies, state } = fakeInteraction({
      sub: "subtitles",
      userId: REQUESTER,
    });
    await h.handler.run(interaction);
    expect(state.deferred).toBe(false);
    expect(h.events).toHaveLength(0);
    expect(replies[0]).toContain("A subtitle picker is already open");
  });

  test("picking Off dispatches an off trackRef", async () => {
    const h = makeHandler({
      view: { ...viewWithCurrent(REQUESTER), positionSeconds: 5 },
      subtitleCandidates: [SIDECAR_CANDIDATE],
    });
    const { interaction } = fakeInteraction({
      sub: "subtitles",
      userId: REQUESTER,
      subtitleMenuPick: "off",
    });
    await h.handler.run(interaction);
    expect(h.events).toEqual([
      {
        type: "CHANGE_SUBTITLES",
        subtitles: { trackRef: { kind: "off" } },
        positionSeconds: 5,
      },
    ]);
  });
});

function playedSource(strings: Record<string, string>) {
  const h = makeHandler({});
  return { h, fake: fakeInteraction({ sub: "play", strings }) };
}

describe("CommandHandler subtitles options", () => {
  test("no subtitle options → source carries no preference", async () => {
    const { h, fake } = playedSource({ query: "a song" });
    await h.handler.run(fake.interaction);
    const event = h.events[0];
    expect(event?.type).toBe("ADD");
    if (event?.type !== "ADD") throw new Error("expected ADD");
    expect(event.source.subtitles).toBeUndefined();
  });

  test("subtitles:on + sublang thread a preference onto the source and ack", async () => {
    const { h, fake } = playedSource({
      query: "a song",
      subtitles: "on",
      sublang: "es",
    });
    await h.handler.run(fake.interaction);
    const event = h.events[0];
    if (event?.type !== "ADD") throw new Error("expected ADD");
    expect(event.source.subtitles).toEqual({ enabled: true, language: "es" });
    expect(fake.edits[0]).toStartWith("Queued: **a song** _(subtitles: es)_");
  });

  test("subtitles:off disables and is reflected in the ack", async () => {
    const { h, fake } = playedSource({ query: "a song", subtitles: "off" });
    await h.handler.run(fake.interaction);
    const event = h.events[0];
    if (event?.type !== "ADD") throw new Error("expected ADD");
    expect(event.source.subtitles).toEqual({ enabled: false });
    expect(fake.edits[0]).toStartWith("Queued: **a song** _(subtitles: off)_");
  });

  test("playlist items inherit the subtitle preference", async () => {
    const h = makeHandler({
      playlistItems: [
        { url: "https://youtube.com/watch?v=1", title: "one" },
        { url: "https://youtube.com/watch?v=2", title: "two" },
      ],
    });
    const fake = fakeInteraction({
      sub: "play",
      strings: {
        query: "https://youtube.com/playlist?list=PL123",
        subtitles: "on",
      },
    });
    await h.handler.run(fake.interaction);
    expect(h.events).toHaveLength(2);
    for (const event of h.events) {
      if (event.type !== "ADD") throw new Error("expected ADD");
      expect(event.source.subtitles).toEqual({ enabled: true });
    }
  });
});

describe("help", () => {
  test("replies with the command reference and source note", async () => {
    const h = makeHandler({});
    const fake = fakeInteraction({ sub: "help" });
    await h.handler.run(fake.interaction);
    expect(h.events).toHaveLength(0);
    const reply = fake.replies[0];
    if (reply === undefined) throw new Error("expected a help reply");
    expect(reply).toContain("/stream play");
    expect(reply).toContain("Supported sources");
    expect(reply).toContain("yt-dlp");
    // Discord rejects messages over 2000 chars.
    expect(reply.length).toBeLessThanOrEqual(2000);
  });

  test("lists every registered subcommand (drift guard)", () => {
    const text = helpText();
    const options = commandJson[0]?.options ?? [];
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      // Each subcommand name must appear as a whole word (the help uses a compact
      // `queue · nowplaying · …` layout, so names aren't all prefixed with `/stream`).
      expect(text).toMatch(new RegExp(String.raw`\b${option.name}\b`));
    }
  });
});

describe("sources", () => {
  test("bare sources defers and paginates the full list", async () => {
    const h = makeHandler({ sources: ["youtube", "twitch:vod", "vimeo"] });
    const fake = fakeInteraction({ sub: "sources" });
    await h.handler.run(fake.interaction);
    expect(fake.state.deferred).toBe(true);
    const payload = fake.paginated[0];
    if (payload === undefined)
      throw new Error("expected a paginated reply payload");
    expect(payload.header).toContain("3 sources");
    expect(payload.pages).toHaveLength(1);
    expect(payload.pages[0]).toContain("`youtube`");
    expect(payload.pages[0]).toContain("`twitch:vod`");
    expect(payload.pages[0]).toContain("`vimeo`");
  });

  test("filtered sources paginate over matches only", async () => {
    const h = makeHandler({
      sources: ["youtube", "twitch:vod", "twitch:clips", "vimeo"],
    });
    const fake = fakeInteraction({
      sub: "sources",
      strings: { query: "TWITCH" },
    });
    await h.handler.run(fake.interaction);
    const payload = fake.paginated[0];
    if (payload === undefined)
      throw new Error("expected a paginated reply payload");
    expect(payload.header).toContain("2 source(s) matching `TWITCH`");
    expect(payload.pages).toHaveLength(1);
    const body = payload.pages[0] ?? "";
    expect(body).toContain("`twitch:vod`");
    expect(body).toContain("`twitch:clips`");
    expect(body).not.toContain("`vimeo`");
  });

  test("filtered sources with no matches return a single explanatory page", async () => {
    const h = makeHandler({ sources: ["youtube", "vimeo"] });
    const fake = fakeInteraction({
      sub: "sources",
      strings: { query: "nope" },
    });
    await h.handler.run(fake.interaction);
    const payload = fake.paginated[0];
    if (payload === undefined)
      throw new Error("expected a paginated reply payload");
    expect(payload.header).toContain("No sources matching `nope`");
    expect(payload.pages).toHaveLength(1);
  });

  test("large source sets split into multiple pages", () => {
    const many = Array.from({ length: 73 }, (_, i) => `site${String(i)}`);
    const { header, pages } = sourcesPages(many, null);
    expect(header).toContain("yt-dlp supports 73 sources");
    // 73 entries at SOURCES_PER_PAGE = 30 → 3 pages (30 + 30 + 13).
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("`site0`");
    expect(pages[0]).toContain("`site29`");
    expect(pages[1]).toContain("`site30`");
    expect(pages[2]).toContain("`site72`");
    // Each page stays well under Discord's 2000-char limit.
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(2000);
    }
  });

  test("filter paginates across many matches", () => {
    const sources = [
      ...Array.from({ length: 50 }, (_, i) => `twitch_${String(i)}`),
      "vimeo",
    ];
    const { header, pages } = sourcesPages(sources, "twitch");
    expect(header).toContain("50 source(s) matching `twitch`");
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(page).not.toContain("vimeo");
    }
  });
});

function entry(title: string): LibraryEntry {
  return {
    title,
    path: `/videos/${title}.mkv`,
    relativePath: `${title}.mkv`,
    library: "movies",
  };
}

describe("list", () => {
  test("bare list defers and paginates the full library", async () => {
    const h = makeHandler({
      library: [entry("Alpha"), entry("Bravo"), entry("Charlie")],
    });
    const fake = fakeInteraction({ sub: "list" });
    await h.handler.run(fake.interaction);
    expect(fake.state.deferred).toBe(true);
    const payload = fake.paginated[0];
    if (payload === undefined)
      throw new Error("expected a paginated reply payload");
    expect(payload.header).toContain("3 result(s)");
    expect(payload.pages).toHaveLength(1);
    expect(payload.pages[0]).toContain("`Alpha`");
    expect(payload.pages[0]).toContain("`Charlie`");
  });

  test("filtered list paginates over fuzzy matches only", async () => {
    const h = makeHandler({
      library: [entry("Alpha One"), entry("Alpha Two"), entry("Bravo")],
    });
    const fake = fakeInteraction({ sub: "list", strings: { filter: "alpha" } });
    await h.handler.run(fake.interaction);
    const payload = fake.paginated[0];
    if (payload === undefined)
      throw new Error("expected a paginated reply payload");
    expect(payload.header).toContain("2 result(s) matching `alpha`");
    const body = payload.pages[0] ?? "";
    expect(body).toContain("`Alpha One`");
    expect(body).toContain("`Alpha Two`");
    expect(body).not.toContain("`Bravo`");
  });

  test("filtered list with no matches returns a single explanatory page", async () => {
    const h = makeHandler({ library: [entry("Alpha")] });
    const fake = fakeInteraction({ sub: "list", strings: { filter: "nope" } });
    await h.handler.run(fake.interaction);
    const payload = fake.paginated[0];
    if (payload === undefined)
      throw new Error("expected a paginated reply payload");
    expect(payload.header).toContain("No matches for `nope`");
  });

  test("/stream search reuses the same paginated helper", async () => {
    const h = makeHandler({ library: [entry("Alpha"), entry("Bravo")] });
    const fake = fakeInteraction({
      sub: "search",
      strings: { query: "Bravo" },
    });
    await h.handler.run(fake.interaction);
    const payload = fake.paginated[0];
    if (payload === undefined)
      throw new Error("expected a paginated reply payload");
    expect(payload.header).toContain("1 result(s) matching `Bravo`");
  });

  test("large libraries split into multiple pages", () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      entry(`Title${String(i)}`),
    );
    const { header, pages } = listPages(many, null);
    expect(header).toContain("45 result(s)");
    // 45 entries at LIST_PER_PAGE = 20 → 3 pages (20 + 20 + 5).
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("`Title0`");
    expect(pages[2]).toContain("`Title44`");
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(2000);
    }
  });
});
