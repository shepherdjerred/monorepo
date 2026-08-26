import { afterEach, describe, expect, test } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  DYNAMIC_FLAG_NAMES,
  describeDynamicConfig,
  initializeConfig,
  karmaAdminUserId,
  karmaEmoji,
  shutdownConfig,
} from "#src/config.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;

afterEach(async () => {
  await shutdownConfig();
});

describe("dynamic config", () => {
  test("covers exactly the Karma entries in the managed inventory", () => {
    const expected = managedFlagInventory.flags
      .filter((flag) => flag.owner === "starlight-karma-bot")
      .map((flag) => flag.key)
      .sort();
    expect([...DYNAMIC_FLAG_NAMES].sort()).toEqual(expected);
  });

  test("falls back to the declared default with no flag and no env", async () => {
    await initializeConfig({ environment: DISABLED });
    await expect(karmaEmoji("guild-1")).resolves.toBe("⭐");
  });

  test("env overrides the default", async () => {
    await initializeConfig({
      environment: { ...DISABLED, KARMA_EMOJI: "🌟" },
    });
    await expect(karmaEmoji("guild-1")).resolves.toBe("🌟");
  });

  test("a flag outranks env — the whole point of the migration", async () => {
    await initializeConfig({
      environment: { ...DISABLED, KARMA_EMOJI: "🌟" },
      provider: new StaticProvider({ "karma-emoji": "🔥" }),
    });
    await expect(karmaEmoji("guild-1")).resolves.toBe("🔥");
  });

  test("an undefined flag falls through to env rather than blanking the value", async () => {
    await initializeConfig({
      environment: { ...DISABLED, KARMA_EMOJI: "🌟" },
      provider: new StaticProvider({ "some-other-flag": true }),
    });
    await expect(karmaEmoji("guild-1")).resolves.toBe("🌟");
  });

  test("the flag key is derived from the config key", async () => {
    // karmaAdminUserId -> karma-admin-user-id, with no per-key override.
    await initializeConfig({
      environment: DISABLED,
      provider: new StaticProvider({ "karma-admin-user-id": "12345" }),
    });
    await expect(karmaAdminUserId("guild-1")).resolves.toBe("12345");
  });

  test("reading before initialize fails loudly", async () => {
    await shutdownConfig();
    // Falling back to an env-only resolver would look identical to a working
    // setup while silently dropping the flag layer.
    await expect(karmaEmoji("guild-1")).rejects.toThrow(
      /before initializeConfig/,
    );
  });

  test("the startup dump reports every key with its source", async () => {
    await initializeConfig({
      environment: { ...DISABLED, KARMA_EMOJI: "🌟" },
    });
    const described = await describeDynamicConfig();
    expect(described).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "karmaEmoji", source: "env" }),
        expect.objectContaining({ key: "karmaAdminUserId", source: "default" }),
      ]),
    );
  });
});
