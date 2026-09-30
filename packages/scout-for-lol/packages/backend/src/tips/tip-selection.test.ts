import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { beforeAll, afterAll, beforeEach } from "vitest";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { FEATURE_TIPS, type FeatureTip } from "#src/tips/tip-catalog.ts";
import { selectTip, type TipReaders } from "#src/tips/tip-selection.ts";

// Deliberately not the beta guild: the local flag registry enables
// feature_tips_enabled there by default, which would mask the "flag off" case.
const guildId = DiscordGuildIdSchema.parse("1200000000000000001");

/**
 * Selection is control flow over four gates: the flag, the cooldown clock, the
 * percentage roll, and eligibility. The flag and the roll run for real — "does
 * a disabled guild get a tip" is exactly what these exist to answer — while
 * the three database reads are injected as plain functions.
 */
function readers(input: {
  lastShownAt?: Date;
  shownKeys?: string[];
  available?: FeatureTip[];
}): TipReaders {
  const shown = new Set<string>(input.shownKeys);
  return {
    lastShownAt: () => Promise.resolve(input.lastShownAt),
    shownTipKeys: () => Promise.resolve(shown),
    eligibleTips: ({ alreadyShown }) =>
      Promise.resolve(
        (input.available ?? FEATURE_TIPS.slice(0, 1)).filter(
          (tip) => !alreadyShown.has(tip.key),
        ),
      ),
  };
}

beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
});

afterAll(async () => {
  resetFlagOverrides("feature_tips_enabled");
  await shutdownFeatureFlags();
});

beforeEach(() => {
  resetFlagOverrides("feature_tips_enabled");
});

describe("selectTip", () => {
  test("offers nothing while the flag is off for the guild", async () => {
    const tip = await selectTip(
      { serverId: guildId },
      { random: () => 0, readers: readers({}) },
    );
    expect(tip).toBeUndefined();
  });

  test("offers the first unused available tip on a winning roll", async () => {
    addFlagOverride("feature_tips_enabled", true, { server: guildId });
    const tip = await selectTip(
      { serverId: guildId },
      { random: () => 0, readers: readers({}) },
    );
    expect(tip?.key).toBe("competitions");
  });

  test("offers nothing on a losing roll", async () => {
    addFlagOverride("feature_tips_enabled", true, { server: guildId });
    const tip = await selectTip(
      { serverId: guildId },
      { random: () => 0.999, readers: readers({}) },
    );
    expect(tip).toBeUndefined();
  });

  test("stays silent inside the cooldown even on a winning roll", async () => {
    addFlagOverride("feature_tips_enabled", true, { server: guildId });
    const now = new Date("2030-01-10T00:00:00Z");
    const tip = await selectTip(
      { serverId: guildId },
      {
        random: () => 0,
        now,
        readers: readers({ lastShownAt: new Date("2030-01-09T23:00:00Z") }),
      },
    );
    expect(tip).toBeUndefined();
  });

  test("offers again once the cooldown has expired", async () => {
    addFlagOverride("feature_tips_enabled", true, { server: guildId });
    const now = new Date("2030-01-10T00:00:00Z");
    const tip = await selectTip(
      { serverId: guildId },
      {
        random: () => 0,
        now,
        readers: readers({ lastShownAt: new Date("2029-12-01T00:00:00Z") }),
      },
    );
    expect(tip?.key).toBe("competitions");
  });

  test("never re-offers a tip this audience has already seen", async () => {
    addFlagOverride("feature_tips_enabled", true, { server: guildId });
    const tip = await selectTip(
      { serverId: guildId },
      { random: () => 0, readers: readers({ shownKeys: ["competitions"] }) },
    );
    expect(tip).toBeUndefined();
  });

  test("never offers a feature the guild already uses", async () => {
    addFlagOverride("feature_tips_enabled", true, { server: guildId });
    const tip = await selectTip(
      { serverId: guildId },
      { random: () => 0, readers: readers({ available: [] }) },
    );
    expect(tip).toBeUndefined();
  });
});
