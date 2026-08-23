import { afterEach, describe, expect, test } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  initializeDynamicConfig,
  isDynamicConfigReady,
  playerCardEnabled,
  shutdownDynamicConfig,
  subtitlesEnabled,
} from "@shepherdjerred/streambot/config/dynamic.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;
const SEED = { playerCardEnabled: true, subtitlesEnabled: true };

afterEach(async () => {
  await shutdownDynamicConfig();
});

describe("streambot dynamic config", () => {
  test("returns the caller's value before initialization", () => {
    // No window where a toggle flips because config was not ready. The call
    // sites pass what they already had.
    expect(isDynamicConfigReady()).toBe(false);
    expect(playerCardEnabled(true)).toBe(true);
    expect(subtitlesEnabled(false)).toBe(false);
  });

  test("a flag outranks the seeded value", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({ "player-card-enabled": false }),
    });
    expect(playerCardEnabled(true)).toBe(false);
  });

  test("an undefined flag leaves the seeded value in place", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({ "some-other-flag": true }),
    });
    expect(playerCardEnabled(true)).toBe(true);
    expect(subtitlesEnabled(false)).toBe(true);
  });

  test("env sits between the flag and the seed", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, SUBTITLES_ENABLED: "true" },
      seed: SEED,
      startPolling: false,
    });
    expect(subtitlesEnabled(false)).toBe(true);
  });

  test("the string false env value disables subtitles", async () => {
    await initializeDynamicConfig({
      environment: { ...DISABLED, SUBTITLES_ENABLED: "false" },
      seed: SEED,
      startPolling: false,
    });
    expect(subtitlesEnabled(true)).toBe(false);
  });

  test("shutdown returns readings to the caller's value", async () => {
    await initializeDynamicConfig({
      environment: DISABLED,
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({ "player-card-enabled": false }),
    });
    expect(playerCardEnabled(true)).toBe(false);
    await shutdownDynamicConfig();
    expect(playerCardEnabled(true)).toBe(true);
  });
});
