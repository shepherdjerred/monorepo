import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GameDriver } from "@shepherdjerred/discord-stream-lifecycle/lifecycle/game-driver.ts";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot.ts";
import { UserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool.ts";
import { SingleSlotSessionManager } from "@shepherdjerred/discord-stream-lifecycle/session/session-manager.ts";
import type { SessionStopReason } from "@shepherdjerred/discord-stream-lifecycle/session/session.ts";

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stats = await stat(p);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

const GUILD_A = "100000000000000001";
const GUILD_B = "100000000000000002";

function makeFakeUserbot(
  userId: string,
  guildIds: readonly string[],
): PooledUserbot {
  return {
    login: async () => {
      await Promise.resolve();
    },
    userId: () => userId,
    guildIds: () => guildIds,
    destroy: async () => {
      await Promise.resolve();
    },
  };
}

type DriverCall =
  | { kind: "start"; guildId: string; sessionDir: string }
  | { kind: "stop"; guildId: string; reason: SessionStopReason };

function makeRecorderDriver(name: string): {
  driver: GameDriver<PooledUserbot>;
  calls: DriverCall[];
} {
  const calls: DriverCall[] = [];
  const driver: GameDriver<PooledUserbot> = {
    name,
    onSessionStart: async (session) => {
      calls.push({
        kind: "start",
        guildId: session.guildId,
        sessionDir: session.sessionDir,
      });
      await Promise.resolve();
    },
    onSessionStop: async (session, reason) => {
      calls.push({ kind: "stop", guildId: session.guildId, reason });
      await Promise.resolve();
    },
  };
  return { driver, calls };
}

function newPool(
  tokens: readonly string[],
  guildsByToken: Record<string, readonly string[]>,
): UserbotPool<PooledUserbot> {
  return new UserbotPool({
    tokens,
    factory: (token) =>
      makeFakeUserbot(`user-${token}`, guildsByToken[token] ?? []),
  });
}

function newDefaultPool(): UserbotPool<PooledUserbot> {
  return newPool(["t1"], { t1: [GUILD_A] });
}

describe("SingleSlotSessionManager — start", () => {
  let stateRootDir: string;
  beforeEach(async () => {
    stateRootDir = await mkdtemp(path.join(tmpdir(), "dsl-test-"));
  });
  afterEach(async () => {
    await rm(stateRootDir, { recursive: true, force: true });
  });

  it("starts a session and creates the session directory", async () => {
    const pool = newDefaultPool();
    await pool.start();
    const { driver, calls } = makeRecorderDriver("test");
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });

    const result = await manager.start({
      guildId: GUILD_A,
      voiceChannelId: "200000000000000001",
      textChannelId: "300000000000000001",
      startedByUserId: "400000000000000001",
    });

    expect(result.kind).toBe("started");
    if (result.kind !== "started") {
      throw new Error("expected started");
    }
    expect(await isDirectory(result.session.sessionDir)).toBe(true);
    expect(result.session.sessionDir).toBe(path.join(stateRootDir, GUILD_A));
    expect(calls).toEqual([
      {
        kind: "start",
        guildId: GUILD_A,
        sessionDir: result.session.sessionDir,
      },
    ]);
    expect(pool.busyCount()).toBe(1);
  });

  it("rejects /play while a session is already active (single-slot)", async () => {
    const pool = newPool(["t1"], { t1: [GUILD_A, GUILD_B] });
    await pool.start();
    const { driver } = makeRecorderDriver("test");
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });

    const first = await manager.start({
      guildId: GUILD_A,
      voiceChannelId: "v1",
      textChannelId: "t1",
      startedByUserId: "u1",
    });
    expect(first.kind).toBe("started");

    const second = await manager.start({
      guildId: GUILD_B,
      voiceChannelId: "v2",
      textChannelId: "t2",
      startedByUserId: "u2",
    });
    expect(second.kind).toBe("alreadyActive");
  });

  it("returns noUserbotAvailable when no member-userbot exists for the guild", async () => {
    const pool = newPool(["t1"], { t1: [GUILD_A] });
    await pool.start();
    const { driver } = makeRecorderDriver("test");
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });

    const result = await manager.start({
      guildId: "999999999999999999",
      voiceChannelId: "v1",
      textChannelId: "t1",
      startedByUserId: "u1",
    });
    expect(result.kind).toBe("noUserbotAvailable");
  });

  it("releases the userbot and reports driverError when onSessionStart throws", async () => {
    const pool = newDefaultPool();
    await pool.start();
    const driver: GameDriver<PooledUserbot> = {
      name: "boom",
      onSessionStart: async () => {
        throw new Error("emulator failed to boot");
      },
      onSessionStop: async () => {
        await Promise.resolve();
      },
    };
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });

    const result = await manager.start({
      guildId: GUILD_A,
      voiceChannelId: "v1",
      textChannelId: "t1",
      startedByUserId: "u1",
    });
    expect(result.kind).toBe("driverError");
    if (result.kind === "driverError") {
      expect(result.error.message).toBe("emulator failed to boot");
    }
    expect(pool.busyCount()).toBe(0);
    expect(manager.getActiveSession()).toBeNull();
  });

  it("rejects invalid guildId in sessionDir path", async () => {
    const pool = new UserbotPool({
      tokens: ["t1"],
      factory: (token) => makeFakeUserbot(token, ["../escape"]),
    });
    await pool.start();
    const { driver } = makeRecorderDriver("test");
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });

    const result = await manager.start({
      guildId: "../escape",
      voiceChannelId: "v1",
      textChannelId: "t1",
      startedByUserId: "u1",
    });
    expect(result.kind).toBe("driverError");
    expect(pool.busyCount()).toBe(0);
  });
});

describe("SingleSlotSessionManager — stop", () => {
  let stateRootDir: string;
  beforeEach(async () => {
    stateRootDir = await mkdtemp(path.join(tmpdir(), "dsl-test-"));
  });
  afterEach(async () => {
    await rm(stateRootDir, { recursive: true, force: true });
  });

  it("stop is idempotent and releases the userbot", async () => {
    const pool = newDefaultPool();
    await pool.start();
    const { driver, calls } = makeRecorderDriver("test");
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });

    await manager.start({
      guildId: GUILD_A,
      voiceChannelId: "v1",
      textChannelId: "t1",
      startedByUserId: "u1",
    });
    expect(pool.busyCount()).toBe(1);

    await manager.stop("userStop");
    expect(pool.busyCount()).toBe(0);
    expect(manager.getActiveSession()).toBeNull();
    expect(calls.find((c) => c.kind === "stop")).toEqual({
      kind: "stop",
      guildId: GUILD_A,
      reason: "userStop",
    });

    await manager.stop("userStop");
    expect(pool.busyCount()).toBe(0);
  });

  it("getActiveSessionForGuild returns null for other guilds", async () => {
    const pool = newPool(["t1"], { t1: [GUILD_A, GUILD_B] });
    await pool.start();
    const { driver } = makeRecorderDriver("test");
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });

    await manager.start({
      guildId: GUILD_A,
      voiceChannelId: "v1",
      textChannelId: "t1",
      startedByUserId: "u1",
    });

    expect(manager.getActiveSessionForGuild(GUILD_A)).not.toBeNull();
    expect(manager.getActiveSessionForGuild(GUILD_B)).toBeNull();
  });

  it("stop still releases the userbot when driver.onSessionStop throws", async () => {
    const pool = newDefaultPool();
    await pool.start();
    const driver: GameDriver<PooledUserbot> = {
      name: "test",
      onSessionStart: async () => {
        await Promise.resolve();
      },
      onSessionStop: async () => {
        throw new Error("save flush failed");
      },
    };
    const manager = new SingleSlotSessionManager({
      pool,
      driver,
      stateRootDir,
    });
    await manager.start({
      guildId: GUILD_A,
      voiceChannelId: "v1",
      textChannelId: "t1",
      startedByUserId: "u1",
    });

    await manager.stop("userStop");
    expect(pool.busyCount()).toBe(0);
    expect(manager.getActiveSession()).toBeNull();
  });
});
