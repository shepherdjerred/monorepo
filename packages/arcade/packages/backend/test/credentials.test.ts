import { describe, expect, it } from "vitest";
import { UserbotPool } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";
import { readCredentials, startArcadePool } from "#src/credentials.ts";
import { createRuntimeConfigs, runtimeDefaults } from "#src/runtime-config.ts";

const fixtureEnv = {
  DISCORD_BOT_TOKEN: "fixture-command-token",
  DISCORD_APPLICATION_ID: "1513064100723167323",
  DISCORD_STREAMING_TOKENS: JSON.stringify([
    "fixture-stream-a",
    "fixture-stream-b",
    "fixture-stream-c",
  ]),
};

describe("Arcade credential ownership", () => {
  it("accepts a variable pool without configured Discord user IDs", () => {
    expect(readCredentials(fixtureEnv).streamingTokens).toHaveLength(3);
    expect(
      readCredentials({
        ...fixtureEnv,
        DISCORD_STREAMING_TOKENS: '["fixture-stream-a"]',
      }).streamingTokens,
    ).toHaveLength(1);
  });

  it("rejects missing, empty, malformed, or duplicate credentials without exposing them", () => {
    for (const raw of [
      undefined,
      "",
      "fixture-stream-a",
      "{}",
      "[]",
      '[""]',
      '["fixture-stream-a"," fixture-stream-a "]',
    ]) {
      expect(() =>
        readCredentials({ ...fixtureEnv, DISCORD_STREAMING_TOKENS: raw }),
      ).toThrow();
      try {
        readCredentials({ ...fixtureEnv, DISCORD_STREAMING_TOKENS: raw });
      } catch (error) {
        expect(String(error)).not.toContain("fixture-stream-a");
      }
    }
    expect(() =>
      readCredentials({ ...fixtureEnv, DISCORD_BOT_TOKEN: "" }),
    ).toThrow();
    expect(() =>
      readCredentials({ ...fixtureEnv, DISCORD_APPLICATION_ID: "invalid" }),
    ).toThrow();
  });

  it("discovers identities and guild membership and leases each account once", async () => {
    const credentials = readCredentials(fixtureEnv);
    const pool = new UserbotPool({
      tokens: credentials.streamingTokens,
      factory: (token) => ({
        login: () => Promise.resolve(),
        destroy: () => Promise.resolve(),
        userId: () => String(credentials.streamingTokens.indexOf(token) + 1),
        guildIds: () => (token.endsWith("c") ? ["other"] : ["launch"]),
      }),
    });
    const excluded = new Set(["streambot-peer"]);
    await startArcadePool(pool, excluded);
    expect(excluded).toEqual(new Set(["1", "2", "3", "streambot-peer"]));
    const first = pool.acquire("launch");
    const second = pool.acquire("launch");
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(pool.acquire("launch")).toBeNull();
    expect(pool.acquire("other")?.userbot.userId()).toBe("3");
    if (first === null) throw new Error("Missing first lease");
    pool.release(first);
    expect(pool.acquire("launch")).toBe(first);
    await pool.destroy();
  });

  it("rejects two tokens resolving to the same account before sessions are admitted", async () => {
    const excluded = new Set<string>();
    await expect(
      startArcadePool(
        {
          start: () => Promise.resolve(),
          size: () => 2,
          userIds: () => new Set(["1"]),
        },
        excluded,
      ),
    ).rejects.toThrow("duplicate Discord accounts");
    expect(excluded.size).toBe(0);
  });

  it("builds credential-free runtimes while preserving per-game saves and settings", () => {
    const configs = createRuntimeConfigs({
      settings: runtimeDefaults,
      stateRoot: "/saves",
      assets: "/assets",
      databasePath: "/db/arcade.db",
    });
    expect(configs.mk64.state_root_dir).toBe("/saves/mk64");
    expect(configs.emerald.state_root_dir).toBe("/saves/emerald");
    expect(configs.mk64.emulator.rom_path).toBe("/assets/mk64/rom.z64");
    expect(configs.emerald.game.wasm_path).toBe(
      "/assets/emerald/pokeemerald.wasm",
    );
    expect(configs.mk64.leaderboard.db_path).toBe("/db/arcade.db");
    expect(configs.mk64.stream.video.bitrate_kbps).toBe(5000);
    expect(configs.emerald.stream.video.bitrate_kbps).toBe(1500);
    expect(configs.emerald.game.commands.hold.duration_in_milliseconds).toBe(
      150,
    );
    expect(configs.emerald.game.goal.enabled).toBe(false);
    expect(configs.mk64).not.toHaveProperty("bot");
    expect(configs.emerald.bot).not.toHaveProperty("discord_token");
    for (const runtime of Object.values(configs))
      expect(runtime.stream).not.toHaveProperty("userbot");
  });
});
