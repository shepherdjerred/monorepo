import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type {
  UserbotEntry,
  UserbotProvider,
} from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer.ts";
import type { Announcement } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  saveState,
  stateFilePath,
  type PersistedState,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const GUILD = GuildIdSchema.parse("100000000000000001");
const CHANNEL_A = ChannelIdSchema.parse("100000000000000010");
const CHANNEL_B = ChannelIdSchema.parse("100000000000000011");
const STATUS = ChannelIdSchema.parse("100000000000000020");
const USER = UserIdSchema.parse("100000000000000099");

const RESOLVED: ResolvedSource = {
  title: "Clip",
  ffmpegInput: "/clip.mkv",
  chapters: [],
};

/** Fake streamer: joins/leaves instantly; runStream parks until the machine aborts it (SKIP/STOP). */
function fakeStreamer(): StreamerLike {
  return {
    joinVoice: (input) =>
      Promise.resolve({ guildId: input.guildId, channelId: input.channelId }),
    runStream: (_input, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => {
          resolve();
        });
      }),
    leaveVoice: () => Promise.resolve(),
    setVolume: () => Promise.resolve(true),
    seek: () => Promise.resolve(true),
    getPosition: () => 0,
    userId: () => "200000000000000000",
    destroy: () => Promise.resolve(),
  };
}

/** A fake pool with a fixed number of interchangeable userbots, tracking acquire/release. */
function fakePool(size: number) {
  const entries: UserbotEntry[] = Array.from({ length: size }, () => ({
    streamer: fakeStreamer(),
    guildIds: new Set([GUILD]),
    busy: false,
  }));
  let acquireCount = 0;
  const released: UserbotEntry[] = [];
  const provider: UserbotProvider = {
    acquire: (guildId) => {
      const entry = entries.find((e) => !e.busy && e.guildIds.has(guildId));
      if (entry === undefined) {
        return null;
      }
      entry.busy = true;
      acquireCount += 1;
      return entry;
    },
    release: (entry) => {
      entry.busy = false;
      released.push(entry);
    },
    canServe: (guildId) => entries.some((e) => e.guildIds.has(guildId)),
  };
  return {
    provider,
    acquireCount: () => acquireCount,
    released,
  };
}

const dirs: string[] = [];
async function makeConfig(): Promise<Config> {
  const dir = await mkdtemp(path.join(tmpdir(), "streambot-session-"));
  dirs.push(dir);
  const base = loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "user",
    VIDEOS_DIR: "/videos",
  });
  return {
    ...base,
    state: { dir, resumeMaxAgeSeconds: 3600 },
    idleTimeoutSeconds: 1,
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await sleep(10);
  }
}

/** Flatten an Announcement (string | {content,...}) to its text for assertions. */
function announcementText(message: Announcement): string {
  return typeof message === "string" ? message : message.content;
}

function makeManager(config: Config, pool: UserbotProvider) {
  const announced: { channelId: string | null; message: Announcement }[] = [];
  const manager = new SessionManager({
    config,
    pool,
    resolveSource: () => Promise.resolve(RESOLVED),
    announce: (channelId, message) => {
      announced.push({ channelId, message });
      return Promise.resolve();
    },
  });
  return { manager, announced };
}

describe("SessionManager", () => {
  test("ensureForPlay returns null when no userbot is available", async () => {
    const config = await makeConfig();
    const pool = fakePool(0);
    const { manager } = makeManager(config, pool.provider);
    const handle = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    expect(handle).toBeNull();
  });

  test("a play starts a session that announces now-playing", async () => {
    const config = await makeConfig();
    const pool = fakePool(1);
    const { manager, announced } = makeManager(config, pool.provider);

    const handle = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    expect(handle).not.toBeNull();
    handle?.dispatch({
      type: "ADD",
      source: { kind: "file", path: "/clip.mkv", title: "Clip" },
      requesterId: USER,
    });

    await waitUntil(() =>
      announced.some((a) =>
        announcementText(a.message).includes("Now playing"),
      ),
    );
    const nowPlaying = announced.find((a) =>
      announcementText(a.message).includes("Now playing"),
    );
    expect(nowPlaying?.channelId).toBe(STATUS);
    expect(pool.acquireCount()).toBe(1);

    await manager.destroyAll();
  });

  test("a second play in the same channel reuses the session (no new userbot)", async () => {
    const config = await makeConfig();
    const pool = fakePool(2);
    const { manager } = makeManager(config, pool.provider);

    const first = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    first?.dispatch({
      type: "ADD",
      source: { kind: "file", path: "/a.mkv", title: "A" },
      requesterId: USER,
    });
    const second = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    expect(second).not.toBeNull();
    expect(pool.acquireCount()).toBe(1);

    await manager.destroyAll();
  });

  test("two channels in one guild get independent sessions + userbots", async () => {
    const config = await makeConfig();
    const pool = fakePool(2);
    const { manager } = makeManager(config, pool.provider);

    manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_B,
      statusChannelId: STATUS,
    });
    expect(pool.acquireCount()).toBe(2);
    expect(manager.getExisting(GUILD, CHANNEL_A)).not.toBeNull();
    expect(manager.getExisting(GUILD, CHANNEL_B)).not.toBeNull();

    await manager.destroyAll();
  });

  test("moveSession rekeys a live session to the new voice channel", async () => {
    const config = await makeConfig();
    const pool = fakePool(1);
    const { manager } = makeManager(config, pool.provider);

    const handle = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    handle?.dispatch({
      type: "ADD",
      source: { kind: "file", path: "/clip.mkv", title: "Clip" },
      requesterId: USER,
    });
    await waitUntil(() => handle?.view().state === "streaming");

    expect(
      manager.moveSession({
        guildId: GUILD,
        fromChannelId: CHANNEL_A,
        toChannelId: CHANNEL_B,
      }),
    ).toBe(true);

    expect(manager.getExisting(GUILD, CHANNEL_A)).toBeNull();
    expect(manager.getExisting(GUILD, CHANNEL_B)).not.toBeNull();

    manager.getExisting(GUILD, CHANNEL_B)?.dispatch({ type: "STOP" });
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_B) === null);
    expect(pool.released.length).toBe(1);

    await manager.destroyAll();
  });

  test("STOP tears the session down and releases the userbot", async () => {
    const config = await makeConfig();
    const pool = fakePool(1);
    const { manager } = makeManager(config, pool.provider);

    const handle = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    handle?.dispatch({
      type: "ADD",
      source: { kind: "file", path: "/clip.mkv", title: "Clip" },
      requesterId: USER,
    });
    // Let it reach streaming, then stop.
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) !== null);
    handle?.dispatch({ type: "STOP" });

    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) === null);
    expect(pool.released.length).toBe(1);
    // The userbot is free again — a fresh play acquires it.
    const again = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    expect(again).not.toBeNull();

    await manager.destroyAll();
  });

  test("resumeAll drops a persisted session no userbot can serve", async () => {
    const config = await makeConfig();
    const file = stateFilePath(config.state.dir, GUILD, CHANNEL_A);
    await saveState(file, persistedWithQueue());
    const { manager } = makeManager(config, {
      acquire: () => null,
      release: () => {
        /* unused */
      },
      canServe: () => false, // no member userbot exists for this guild
    });

    await manager.resumeAll();
    expect(await Bun.file(file).exists()).toBe(false);
  });

  test("resumeAll keeps a persisted session when a member userbot is merely busy", async () => {
    const config = await makeConfig();
    const file = stateFilePath(config.state.dir, GUILD, CHANNEL_A);
    await saveState(file, persistedWithQueue());
    const { manager } = makeManager(config, {
      acquire: () => null, // all member userbots currently busy
      release: () => {
        /* unused */
      },
      canServe: () => true,
    });

    await manager.resumeAll();
    expect(await Bun.file(file).exists()).toBe(true);
  });
});

/** A persisted state with one queued item (so resumeAll has something to resume). */
function persistedWithQueue(): PersistedState {
  return {
    version: 2,
    savedAt: Date.now(),
    guildId: GUILD,
    channelId: CHANNEL_A,
    statusChannelId: STATUS,
    loop: "off",
    volume: 100,
    current: null,
    queue: [
      {
        source: { kind: "file", path: "/clip.mkv", title: "Clip" },
        requesterId: USER,
      },
    ],
    resumeAttempts: 0,
    resumeKey: null,
  };
}
