import { describe, expect, it } from "bun:test";
import { UserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool.ts";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot.ts";

function makeFakeUserbot(params: {
  userId: string;
  guildIds: readonly string[];
  failLogin?: boolean;
}): PooledUserbot {
  return {
    login: async () => {
      if (params.failLogin === true) {
        throw new Error(`login failed for ${params.userId}`);
      }
      await Promise.resolve();
    },
    userId: () => params.userId,
    guildIds: () => params.guildIds,
    destroy: async () => {
      await Promise.resolve();
    },
  };
}

describe("UserbotPool", () => {
  it("logs every token in and snapshots guild membership", async () => {
    const pool = new UserbotPool({
      tokens: ["token-a", "token-b"],
      factory: (token) =>
        makeFakeUserbot({
          userId: token === "token-a" ? "user-a" : "user-b",
          guildIds: token === "token-a" ? ["guild-1"] : ["guild-1", "guild-2"],
        }),
    });
    await pool.start();
    expect(pool.size()).toBe(2);
    expect(pool.serveableGuildIds()).toEqual(new Set(["guild-1", "guild-2"]));
  });

  it("acquire returns a free userbot that is a member of the guild", async () => {
    const pool = new UserbotPool({
      tokens: ["t1", "t2"],
      factory: (token) =>
        makeFakeUserbot({
          userId: token,
          guildIds: token === "t1" ? ["guild-A"] : ["guild-B"],
        }),
    });
    await pool.start();

    const entryA = pool.acquire("guild-A");
    expect(entryA).not.toBeNull();
    expect(entryA?.busy).toBe(true);
    expect(entryA?.userbot.userId()).toBe("t1");

    const entryB = pool.acquire("guild-B");
    expect(entryB).not.toBeNull();
    expect(entryB?.userbot.userId()).toBe("t2");

    // No member-userbot for guild-C
    expect(pool.acquire("guild-C")).toBeNull();
  });

  it("acquire returns null when all member-userbots are busy", async () => {
    const pool = new UserbotPool({
      tokens: ["t1"],
      factory: () => makeFakeUserbot({ userId: "u1", guildIds: ["guild-A"] }),
    });
    await pool.start();

    const first = pool.acquire("guild-A");
    expect(first).not.toBeNull();
    expect(pool.acquire("guild-A")).toBeNull();

    if (first !== null) {
      pool.release(first);
    }
    expect(pool.acquire("guild-A")).not.toBeNull();
  });

  it("canServe ignores busy state", async () => {
    const pool = new UserbotPool({
      tokens: ["t1"],
      factory: () => makeFakeUserbot({ userId: "u1", guildIds: ["guild-A"] }),
    });
    await pool.start();
    pool.acquire("guild-A");
    expect(pool.canServe("guild-A")).toBe(true);
    expect(pool.canServe("guild-X")).toBe(false);
  });

  it("skips tokens whose login fails but still serves the rest", async () => {
    const pool = new UserbotPool({
      tokens: ["good", "bad"],
      factory: (token) =>
        makeFakeUserbot({
          userId: token,
          guildIds: ["guild-A"],
          failLogin: token === "bad",
        }),
    });
    await pool.start();
    expect(pool.size()).toBe(1);
    expect(pool.acquire("guild-A")?.userbot.userId()).toBe("good");
  });

  it("throws when every token fails to log in", async () => {
    const pool = new UserbotPool({
      tokens: ["bad-1", "bad-2"],
      factory: (token) =>
        makeFakeUserbot({ userId: token, guildIds: [], failLogin: true }),
    });
    await expect(pool.start()).rejects.toThrow(/no userbots could log in/);
  });

  it("busyCount tracks acquire/release", async () => {
    const pool = new UserbotPool({
      tokens: ["t1", "t2"],
      factory: (token) =>
        makeFakeUserbot({ userId: token, guildIds: ["guild-A"] }),
    });
    await pool.start();
    expect(pool.busyCount()).toBe(0);
    const e1 = pool.acquire("guild-A");
    expect(pool.busyCount()).toBe(1);
    const e2 = pool.acquire("guild-A");
    expect(pool.busyCount()).toBe(2);
    if (e1 !== null) {
      pool.release(e1);
    }
    expect(pool.busyCount()).toBe(1);
    if (e2 !== null) {
      pool.release(e2);
    }
    expect(pool.busyCount()).toBe(0);
  });
});
