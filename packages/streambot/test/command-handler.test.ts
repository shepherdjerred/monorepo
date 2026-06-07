import { describe, expect, test } from "bun:test";
import {
  CommandHandler,
  type CommandHandlerDeps,
  type CommandInteraction,
  type PlaybackView,
} from "@shepherdjerred/streambot/discord/command-handler.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import {
  UserIdSchema,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";

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

const EMPTY_VIEW: PlaybackView = {
  state: "idle",
  current: null,
  queue: [],
  loop: "off",
  volume: 100,
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
  playlistItems?: { url: string; title: string }[];
}): Harness {
  const events: PlaybackEvent[] = [];
  const announces: string[] = [];
  const deps: CommandHandlerDeps = {
    config: makeConfig(over.adminIds ?? []),
    dispatch: (event) => events.push(event),
    view: () => over.view ?? EMPTY_VIEW,
    library: () => over.library ?? [],
    setVolume: () => Promise.resolve(over.volumeApplied ?? true),
    expandPlaylist: () => Promise.resolve(over.playlistItems ?? []),
    announce: (message) => {
      announces.push(message);
      return Promise.resolve();
    },
  };
  return { handler: new CommandHandler(deps), events, announces };
}

type FakeOpts = {
  userId?: string;
  sub: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
};

function fakeInteraction(opts: FakeOpts): {
  interaction: CommandInteraction;
  replies: string[];
  edits: string[];
  state: { deferred: boolean };
} {
  const replies: string[] = [];
  const edits: string[] = [];
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
  };
  return { interaction, replies, edits, state };
}

function viewWithCurrent(requesterId: string): PlaybackView {
  return {
    ...EMPTY_VIEW,
    state: "streaming",
    current: { title: "Current Song", requesterId: uid(requesterId) },
  };
}

describe("CommandHandler routing + acks", () => {
  test("play queues a search source and acks", async () => {
    const h = makeHandler({});
    const { interaction, replies } = fakeInteraction({
      sub: "play",
      strings: { query: "never gonna give you up" },
    });
    await h.handler.run(interaction);
    expect(h.events).toEqual([
      {
        type: "ADD",
        source: { kind: "search", query: "never gonna give you up" },
        requesterId: uid(REQUESTER),
      },
    ]);
    expect(replies[0]).toBe("Queued: **never gonna give you up**");
  });

  test("playnext unshifts (ADD_NEXT) and acks", async () => {
    const h = makeHandler({});
    const { interaction, replies } = fakeInteraction({
      sub: "playnext",
      strings: { query: "song" },
    });
    await h.handler.run(interaction);
    expect(h.events[0]?.type).toBe("ADD_NEXT");
    expect(replies[0]).toBe("Up next: **song**");
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
    expect(edits[0]).toBe("Queued 2 item(s) from the playlist.");
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
      queue: [{ title: "Item A", requesterId: uid(OTHER) }],
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
