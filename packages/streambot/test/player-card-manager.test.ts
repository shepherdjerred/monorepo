import { describe, expect, test } from "bun:test";
import {
  PlayerCardManager,
  type CardOwner,
  type PlayerCardPort,
} from "@shepherdjerred/streambot/discord/player-card-manager.ts";
import type { PlayerCardPayload } from "@shepherdjerred/streambot/discord/player-card.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import type { PosterInfo } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const GUILD = GuildIdSchema.parse("200000000000000001");
const VOICE = ChannelIdSchema.parse("200000000000000002");
const OTHER_VOICE = ChannelIdSchema.parse("200000000000000003");
const STATUS = ChannelIdSchema.parse("200000000000000004");
const REQUESTER = UserIdSchema.parse("100000000000000002");

const OWNER: CardOwner = { guildId: GUILD, voiceChannelId: VOICE };

/** Let the manager's serialized Discord-effect chain settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function streaming(
  title: string,
  over: Partial<PlaybackView> = {},
): PlaybackView {
  return {
    state: "streaming",
    current: {
      title,
      requesterId: REQUESTER,
      chapters: [],
      kind: "file",
      durationSeconds: 600,
    },
    queue: [],
    loop: "off",
    volume: 100,
    positionSeconds: 5,
    ...over,
  };
}

type Recorder = {
  port: PlayerCardPort;
  posts: { channelId: string; payload: PlayerCardPayload; owner: CardOwner }[];
  edits: { messageId: string; payload: PlayerCardPayload }[];
  stripped: string[];
  removed: string[];
  registered: { messageId: string; owner: CardOwner }[];
  unregistered: string[];
  /** Make the next `edit` report the message as gone. */
  failNextEdit: () => void;
};

function recorder(): Recorder {
  const posts: Recorder["posts"] = [];
  const edits: Recorder["edits"] = [];
  const stripped: string[] = [];
  const removed: string[] = [];
  const registered: Recorder["registered"] = [];
  const unregistered: string[] = [];
  let nextId = 0;
  let editFails = false;
  return {
    posts,
    edits,
    stripped,
    removed,
    registered,
    unregistered,
    failNextEdit: () => {
      editFails = true;
    },
    port: {
      post: (channelId, payload, owner) => {
        nextId += 1;
        const messageId = `card-${String(nextId)}`;
        posts.push({ channelId, payload, owner });
        registered.push({ messageId, owner });
        return Promise.resolve(messageId);
      },
      edit: (_channelId, messageId, payload) => {
        if (editFails) {
          editFails = false;
          return Promise.resolve(false);
        }
        edits.push({ messageId, payload });
        return Promise.resolve(true);
      },
      strip: (_channelId, messageId) => {
        stripped.push(messageId);
        return Promise.resolve();
      },
      remove: (_channelId, messageId) => {
        removed.push(messageId);
        return Promise.resolve();
      },
      register: (messageId, owner) => {
        registered.push({ messageId, owner });
      },
      unregister: (messageId) => {
        unregistered.push(messageId);
      },
    },
  };
}

function harness(
  options: {
    enabled?: boolean;
    tickMs?: number;
    repostAfterMessages?: number;
    fetchPoster?: (
      title: string,
      year: number | null,
    ) => Promise<PosterInfo | null>;
    statusChannelId?: typeof STATUS | null;
  } = {},
) {
  const rec = recorder();
  let current: PlaybackView = streaming("Heat (1995)");
  let tick: (() => void) | null = null;
  const manager = new PlayerCardManager({
    owner: OWNER,
    statusChannelId:
      options.statusChannelId === undefined ? STATUS : options.statusChannelId,
    port: rec.port,
    view: () => current,
    enabled: options.enabled ?? true,
    tickMs: options.tickMs ?? 10_000,
    repostAfterMessages: options.repostAfterMessages ?? 5,
    ...(options.fetchPoster === undefined
      ? {}
      : { fetchPoster: options.fetchPoster }),
    schedule: (fn) => {
      tick = fn;
      return () => {
        tick = null;
      };
    },
  });
  return {
    manager,
    rec,
    setView: (next: PlaybackView) => {
      current = next;
    },
    fireTick: () => {
      tick?.();
    },
    hasTick: () => tick !== null,
  };
}

describe("posting a card", () => {
  test("posts when a title reaches streaming, registered to its session", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    expect(h.rec.posts).toHaveLength(1);
    expect(h.rec.posts[0]?.channelId).toBe(STATUS);
    expect(h.rec.posts[0]?.owner).toEqual(OWNER);
    expect(h.rec.registered[0]).toEqual({ messageId: "card-1", owner: OWNER });
  });

  test("does not post before anything is streaming", async () => {
    const h = harness();
    h.setView(streaming("Heat (1995)", { state: "resolving" }));
    h.manager.refresh();
    await flush();
    expect(h.rec.posts).toEqual([]);
  });

  test("no status channel means no card at all", async () => {
    const h = harness({ statusChannelId: null });
    h.manager.refresh();
    await flush();
    expect(h.rec.posts).toEqual([]);
    expect(h.hasTick()).toBe(false);
  });
});

describe("keeping one card per track", () => {
  test("re-renders in place while the same track plays", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    h.setView(streaming("Heat (1995)", { positionSeconds: 120 }));
    h.manager.refresh();
    await flush();
    expect(h.rec.posts).toHaveLength(1);
    expect(h.rec.edits).toHaveLength(1);
    expect(h.rec.edits[0]?.messageId).toBe("card-1");
  });

  test("skips the edit when nothing visible changed", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    h.manager.refresh();
    h.manager.refresh();
    await flush();
    expect(h.rec.edits).toEqual([]);
  });

  test("a crash retry dropping out of streaming keeps the same card", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    h.setView(streaming("Heat (1995)", { state: "resolving" }));
    h.manager.refresh();
    await flush();
    h.setView(streaming("Heat (1995)", { positionSeconds: 200 }));
    h.manager.refresh();
    await flush();
    expect(h.rec.posts).toHaveLength(1);
    expect(h.rec.stripped).toEqual([]);
  });

  test("a new title retires the old card and posts a fresh one", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    h.setView(streaming("Sneakers (1992)"));
    h.manager.refresh();
    await flush();
    expect(h.rec.stripped).toEqual(["card-1"]);
    expect(h.rec.posts).toHaveLength(2);
    expect(h.rec.posts[1]?.payload.embed?.title).toBe("▶️ Sneakers (1992)");
  });

  test("re-posts when the card is deleted out from under us", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    h.rec.failNextEdit();
    h.setView(streaming("Heat (1995)", { positionSeconds: 120 }));
    h.manager.refresh();
    await flush();
    expect(h.rec.posts).toHaveLength(2);
  });
});

describe("ticking", () => {
  test("the tick advances the rendered position", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    h.setView(streaming("Heat (1995)", { positionSeconds: 425 }));
    h.fireTick();
    await flush();
    expect(h.rec.edits[0]?.payload.embed?.description).toContain(
      "`7:05 / 10:00`",
    );
  });

  test("tickMs of 0 schedules no timer", () => {
    expect(harness({ tickMs: 0 }).hasTick()).toBe(false);
  });
});

describe("re-posting when chat buries the card", () => {
  test("re-posts after the configured number of messages", async () => {
    const h = harness({ repostAfterMessages: 3 });
    h.manager.refresh();
    await flush();
    h.manager.onChannelMessage("msg-1");
    h.manager.onChannelMessage("msg-2");
    await flush();
    expect(h.rec.removed).toEqual([]);
    h.manager.onChannelMessage("msg-3");
    await flush();
    expect(h.rec.removed).toEqual(["card-1"]);
    expect(h.rec.posts).toHaveLength(2);
  });

  test("the card's own message does not count toward burying it", async () => {
    const h = harness({ repostAfterMessages: 1 });
    h.manager.refresh();
    await flush();
    h.manager.onChannelMessage("card-1");
    await flush();
    expect(h.rec.posts).toHaveLength(1);
    expect(h.rec.removed).toEqual([]);
  });

  test("repostAfterMessages of 0 disables re-posting", async () => {
    const h = harness({ repostAfterMessages: 0 });
    h.manager.refresh();
    await flush();
    for (let i = 0; i < 20; i += 1) {
      h.manager.onChannelMessage(`msg-${String(i)}`);
    }
    await flush();
    expect(h.rec.posts).toHaveLength(1);
  });
});

describe("posters", () => {
  test("a poster that arrives late is applied to the card it was fetched for", async () => {
    const pending = Promise.withResolvers<PosterInfo | null>();
    const h = harness({ fetchPoster: () => pending.promise });
    h.manager.refresh();
    await flush();
    expect(h.rec.posts[0]?.payload.embed?.thumbnailUrl).toBeNull();

    pending.resolve({ posterUrl: "https://img/heat.jpg", tmdbTitle: "Heat" });
    await flush();
    expect(h.rec.edits.at(-1)?.payload.embed?.thumbnailUrl).toBe(
      "https://img/heat.jpg",
    );
  });

  test("a poster resolving after the track changed is discarded", async () => {
    const pending = Promise.withResolvers<PosterInfo | null>();
    let calls = 0;
    const h = harness({
      fetchPoster: () => {
        calls += 1;
        // Only the first lookup is left pending; later tracks resolve immediately with nothing.
        return calls === 1 ? pending.promise : Promise.resolve(null);
      },
    });
    h.manager.refresh();
    await flush();
    h.setView(streaming("Sneakers (1992)"));
    h.manager.refresh();
    await flush();

    pending.resolve({ posterUrl: "https://img/heat.jpg", tmdbTitle: "Heat" });
    await flush();
    for (const edit of h.rec.edits) {
      expect(edit.payload.embed?.thumbnailUrl).not.toBe("https://img/heat.jpg");
    }
  });

  test("no poster is fetched for a non-file source", async () => {
    let called = false;
    const h = harness({
      fetchPoster: () => {
        called = true;
        return Promise.resolve(null);
      },
    });
    h.setView(
      streaming("Some Video", {
        current: {
          title: "Some Video",
          requesterId: REQUESTER,
          chapters: [],
          kind: "url",
          durationSeconds: null,
        },
      }),
    );
    h.manager.refresh();
    await flush();
    expect(called).toBe(false);
  });
});

describe("session moves", () => {
  test("re-registers the live card against the new voice channel", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    h.manager.reown(OTHER_VOICE);
    expect(h.rec.registered.at(-1)).toEqual({
      messageId: "card-1",
      owner: { guildId: GUILD, voiceChannelId: OTHER_VOICE },
    });
  });
});

describe("finalize", () => {
  test("renders a control-less final card and stops routing clicks", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    await h.manager.finalize();
    const final = h.rec.edits.at(-1)?.payload;
    expect(final?.rows).toEqual([]);
    expect(final?.select).toBeNull();
    expect(final?.embed?.description).toContain("⏹️ Stopped.");
    expect(h.rec.unregistered).toEqual(["card-1"]);
    expect(h.hasTick()).toBe(false);
  });

  test("later refreshes and ticks are inert", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    await h.manager.finalize();
    const editsAfterFinalize = h.rec.edits.length;
    h.setView(streaming("Sneakers (1992)"));
    h.manager.refresh();
    h.manager.onChannelMessage("msg-1");
    await flush();
    expect(h.rec.edits).toHaveLength(editsAfterFinalize);
    expect(h.rec.posts).toHaveLength(1);
  });

  test("is safe to call twice", async () => {
    const h = harness();
    h.manager.refresh();
    await flush();
    await h.manager.finalize();
    await h.manager.finalize();
    expect(h.rec.unregistered).toEqual(["card-1"]);
  });
});

describe("card disabled by config", () => {
  test("posts a plain announcement per track and never edits or ticks", async () => {
    const h = harness({ enabled: false });
    expect(h.hasTick()).toBe(false);
    h.manager.refresh();
    await flush();
    h.setView(streaming("Heat (1995)", { positionSeconds: 300 }));
    h.manager.refresh();
    await flush();
    h.setView(streaming("Sneakers (1992)"));
    h.manager.refresh();
    await flush();

    expect(h.rec.posts.map((post) => post.payload.content)).toEqual([
      `▶️ Now playing **Heat (1995)** (requested by <@${REQUESTER}>)`,
      `▶️ Now playing **Sneakers (1992)** (requested by <@${REQUESTER}>)`,
    ]);
    expect(h.rec.edits).toEqual([]);
    expect(h.rec.stripped).toEqual([]);
  });
});
