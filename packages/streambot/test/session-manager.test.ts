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
import type {
  StreamerLike,
  VoiceCloseInfo,
} from "@shepherdjerred/streambot/streamer/streamer.ts";
import type { Announcement } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type {
  ResolvedSource,
  RunStreamInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  loadState,
  saveState,
  stateFilePath,
  type PersistedState,
} from "@shepherdjerred/streambot/state/persistence.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
  type ChannelId,
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

/**
 * Fake streamer: joins/leaves instantly; runStream parks until the machine aborts it (SKIP/STOP).
 * `triggerVoiceClose` simulates Discord killing the voice session (fires the registered listener,
 * like the real streamer does from the fork's `close` event).
 */
type FakeStreamer = StreamerLike & {
  triggerVoiceClose: (info: VoiceCloseInfo) => void;
  positionSeconds: { value: number | null };
  lastRunStreamInput: { value: RunStreamInput | null };
};

function fakeStreamer(): FakeStreamer {
  let lastClose: VoiceCloseInfo | null = null;
  let listener: ((info: VoiceCloseInfo) => void) | null = null;
  const positionSeconds = { value: 0 };
  const lastRunStreamInput: { value: RunStreamInput | null } = { value: null };
  return {
    login: () => Promise.resolve(),
    guildIds: () => [GUILD],
    joinVoice: (input) =>
      Promise.resolve({ guildId: input.guildId, channelId: input.channelId }),
    runStream: (input, signal) =>
      new Promise<void>((resolve) => {
        lastRunStreamInput.value = input;
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
    getPosition: () => positionSeconds.value,
    userId: () => "200000000000000000",
    destroy: () => Promise.resolve(),
    lastVoiceCloseInfo: () => lastClose,
    setVoiceCloseListener: (next) => {
      listener = next;
    },
    triggerVoiceClose: (info) => {
      lastClose = info;
      listener?.(info);
    },
    positionSeconds,
    lastRunStreamInput,
  };
}

/** A fake pool with a fixed number of interchangeable userbots, tracking acquire/release. */
function fakePool(size: number) {
  const streamers: FakeStreamer[] = Array.from({ length: size }, () =>
    fakeStreamer(),
  );
  const entries: UserbotEntry[] = streamers.map((userbot) => ({
    userbot,
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
    streamers,
    entries,
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

async function waitForAsync(
  predicate: () => Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitForAsync timed out");
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

  test("moveSession carries the resume-state file to the new channel path", async () => {
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

    // Seed a snapshot at the OLD channel path so we can prove it follows the move (VOICE_TARGET_MOVED
    // alone writes no snapshot, so without moveState the new path would be empty).
    const oldFile = stateFilePath(config.state.dir, GUILD, CHANNEL_A);
    await saveState(oldFile, persistedAt(CHANNEL_A));

    expect(
      manager.moveSession({
        guildId: GUILD,
        fromChannelId: CHANNEL_A,
        toChannelId: CHANNEL_B,
      }),
    ).toBe(true);

    const newFile = stateFilePath(config.state.dir, GUILD, CHANNEL_B);
    // moveState is fire-and-forget; wait for the new path to appear and the old one to vanish.
    await waitForAsync(
      async () =>
        (await Bun.file(newFile).exists()) &&
        !(await Bun.file(oldFile).exists()),
    );
    const moved = await loadState(newFile, 3600);
    expect(moved).not.toBeNull();
    // The file's channelId was rewritten to the destination so resume's channel check passes.
    expect(moved?.channelId).toBe(CHANNEL_B);

    manager.getExisting(GUILD, CHANNEL_B)?.dispatch({ type: "STOP" });
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_B) === null);

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

/** A persisted snapshot keyed to a specific channel (used to prove a move carries the file across). */
function persistedAt(channelId: ChannelId): PersistedState {
  return { ...persistedWithQueue(), channelId };
}

/** Config with fast reconnect knobs for the voice-loss recovery tests. */
async function makeReconnectConfig(
  overrides: Partial<Config["reconnect"]> = {},
): Promise<Config> {
  const base = await makeConfig();
  return {
    ...base,
    reconnect: {
      enabled: true,
      delaySeconds: 1,
      maxAttempts: 2,
      ...overrides,
    },
  };
}

/** Start a session in CHANNEL_A and wait until it is streaming (Now playing announced). */
async function startStreaming(
  manager: SessionManager,
  announced: { channelId: string | null; message: Announcement }[],
): Promise<void> {
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
    announced.some((a) => announcementText(a.message).includes("Now playing")),
  );
}

describe("SessionManager voice-loss recovery", () => {
  test("transient close: state survives teardown and the session auto-resumes at position", async () => {
    const config = await makeReconnectConfig();
    const pool = fakePool(1);
    const { manager, announced } = makeManager(config, pool.provider);
    await startStreaming(manager, announced);

    const streamer = pool.streamers[0];
    if (streamer === undefined) throw new Error("missing fake streamer");
    streamer.positionSeconds.value = 123;
    streamer.triggerVoiceClose({
      code: 4006,
      deliberate: false,
      atMs: Date.now(),
    });

    // The session tears down with a visible reason, keeping the state file.
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) === null);
    const file = stateFilePath(config.state.dir, GUILD, CHANNEL_A);
    expect(await Bun.file(file).exists()).toBe(true);
    await waitUntil(() =>
      announced.some((a) =>
        announcementText(a.message).includes(
          "voice connection dropped (close code 4006) — reconnecting shortly",
        ),
      ),
    );

    // After the delay, it re-acquires the userbot and resumes at the checkpointed position.
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) !== null, 5000);
    expect(pool.acquireCount()).toBe(2);
    await waitUntil(
      () => streamer.lastRunStreamInput.value?.seekSeconds === 123,
    );

    await manager.destroyAll();
  });

  test("deliberate close (fresh 4014): stays down, deletes state, announces the kick", async () => {
    const config = await makeReconnectConfig();
    const pool = fakePool(1);
    const { manager, announced } = makeManager(config, pool.provider);
    await startStreaming(manager, announced);

    pool.streamers[0]?.triggerVoiceClose({
      code: 4014,
      deliberate: true,
      atMs: Date.now(),
    });

    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) === null);
    await waitUntil(() =>
      announced.some((a) =>
        announcementText(a.message).includes(
          "streamer was disconnected from voice (close code 4014)",
        ),
      ),
    );
    const file = stateFilePath(config.state.dir, GUILD, CHANNEL_A);
    await waitForAsync(async () => !(await Bun.file(file).exists()));

    // Long enough for the (not-scheduled) reconnect delay to have elapsed.
    await sleep(1500);
    expect(manager.getExisting(GUILD, CHANNEL_A)).toBeNull();
    expect(pool.acquireCount()).toBe(1);

    await manager.destroyAll();
  });

  test("reconnect disabled: transient close stays down like today, but announces the reason", async () => {
    const config = await makeReconnectConfig({ enabled: false });
    const pool = fakePool(1);
    const { manager, announced } = makeManager(config, pool.provider);
    await startStreaming(manager, announced);

    pool.streamers[0]?.triggerVoiceClose({
      code: 4006,
      deliberate: false,
      atMs: Date.now(),
    });

    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) === null);
    const stopped = announced.find((a) =>
      announcementText(a.message).includes(
        "voice connection dropped (close code 4006)",
      ),
    );
    expect(stopped).toBeDefined();
    expect(
      announcementText(stopped?.message ?? "").includes("reconnecting"),
    ).toBe(false);
    const file = stateFilePath(config.state.dir, GUILD, CHANNEL_A);
    await waitForAsync(async () => !(await Bun.file(file).exists()));

    await sleep(1500);
    expect(manager.getExisting(GUILD, CHANNEL_A)).toBeNull();
    expect(pool.acquireCount()).toBe(1);

    await manager.destroyAll();
  });

  test("manual re-play during the reconnect window wins; the timer no-ops", async () => {
    const config = await makeReconnectConfig();
    const pool = fakePool(1);
    const { manager, announced } = makeManager(config, pool.provider);
    await startStreaming(manager, announced);

    pool.streamers[0]?.triggerVoiceClose({
      code: 4006,
      deliberate: false,
      atMs: Date.now(),
    });
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) === null);

    // User re-plays before the reconnect timer fires.
    const handle = manager.ensureForPlay({
      guildId: GUILD,
      voiceChannelId: CHANNEL_A,
      statusChannelId: STATUS,
    });
    expect(handle).not.toBeNull();
    handle?.dispatch({
      type: "ADD",
      source: { kind: "file", path: "/other.mkv", title: "Other" },
      requesterId: USER,
    });

    await sleep(1500);
    // Manual session (acquire #2) is intact; the recovery did not spawn a third acquire.
    expect(manager.getExisting(GUILD, CHANNEL_A)).not.toBeNull();
    expect(pool.acquireCount()).toBe(2);

    await manager.destroyAll();
  });

  test("saturated pool: waits (without burning the reconnect budget) then resumes when a userbot frees", async () => {
    const config = await makeReconnectConfig({ maxAttempts: 2 });
    const pool = fakePool(1);
    const { manager, announced } = makeManager(config, pool.provider);
    await startStreaming(manager, announced);

    pool.streamers[0]?.triggerVoiceClose({
      code: 4006,
      deliberate: false,
      atMs: Date.now(),
    });
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) === null);
    // Steal the released userbot so every reconnect attempt finds the pool saturated (a member
    // userbot exists — canServe true — but it is busy serving another stream).
    const stolen = pool.provider.acquire(GUILD);
    if (stolen === null) throw new Error("expected to steal the freed userbot");

    // Several reconnect windows (delaySeconds: 1) elapse while the pool stays saturated. Because no
    // rejoin is ever attempted, the budget must NOT be consumed: no "Couldn't reconnect" exhaustion
    // announcement, and the state file is preserved so the movie isn't lost.
    await sleep(3500);
    expect(
      announced.some((a) =>
        announcementText(a.message).includes("Couldn't reconnect"),
      ),
    ).toBe(false);
    const file = stateFilePath(config.state.dir, GUILD, CHANNEL_A);
    expect(await Bun.file(file).exists()).toBe(true);
    expect(manager.getExisting(GUILD, CHANNEL_A)).toBeNull();

    // Free the userbot back into the pool — the next reconnect window acquires it and resumes.
    pool.provider.release(stolen);
    await waitUntil(() => manager.getExisting(GUILD, CHANNEL_A) !== null, 5000);
    // Original stream (#1), the steal (#2), and the successful resume (#3).
    expect(pool.acquireCount()).toBe(3);

    await manager.destroyAll();
  });
});
