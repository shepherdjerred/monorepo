import type { DiscordGuildId } from "@scout-for-lol/data";
import { afterAll, beforeAll, beforeEach, expect } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { countReportSlotsTaken } from "#src/reports/duckdb/instance.ts";
import { resetTestLake } from "#src/testing/report-lake/test-report-lake.ts";

const PLAYER_PROFILE_FLAG = "scout-consumer-player-profiles-enabled";

export function configureConsumerProfileFeatureTest(
  guildIds: DiscordGuildId[],
) {
  const previousEnvironment = Bun.env["ENVIRONMENT"];
  const previousRole = Bun.env["SCOUT_RUNTIME_ROLE"];
  const previousAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  Bun.env["ENVIRONMENT"] = "beta";
  // Hosted stages name their role; the web surface is the application's.
  Bun.env["SCOUT_RUNTIME_ROLE"] = "application";
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = guildIds.join(",");
  resetConfigurationForTests();
  const lakeDir = resolveLakeDir();

  return {
    lakeDir,
    initialize: async () => {
      await initFeatureFlags({
        environment: { FEATURE_FLAGS_MODE: "disabled" },
      });
    },
    enable: (...enabledGuildIds: DiscordGuildId[]) => {
      for (const server of enabledGuildIds) {
        addFlagOverride(PLAYER_PROFILE_FLAG, true, { server });
      }
    },
    reset: () => {
      resetFlagOverrides(PLAYER_PROFILE_FLAG);
    },
    resetLake: async () => {
      await resetTestLake(lakeDir);
    },
    restore: async () => {
      resetFlagOverrides(PLAYER_PROFILE_FLAG);
      await shutdownFeatureFlags();
      if (previousEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
      else Bun.env["ENVIRONMENT"] = previousEnvironment;
      if (previousRole === undefined) delete Bun.env["SCOUT_RUNTIME_ROLE"];
      else Bun.env["SCOUT_RUNTIME_ROLE"] = previousRole;
      if (previousAllowlist === undefined)
        delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
      else Bun.env["EXPLORE_GUILD_ALLOWLIST"] = previousAllowlist;
      resetConfigurationForTests();
    },
  };
}

type ConsumerProfileFeatureTest = ReturnType<
  typeof configureConsumerProfileFeatureTest
>;

export function registerConsumerProfileFeatureTestLifecycle(options: {
  feature: ConsumerProfileFeatureTest;
  prepare: () => Promise<void>;
  cleanup: () => Promise<void>;
}): void {
  beforeAll(options.feature.initialize);
  beforeEach(async () => {
    options.feature.reset();
    await options.prepare();
  });
  afterAll(async () => {
    try {
      await options.cleanup();
    } finally {
      await options.feature.restore();
    }
  });
}

/**
 * Run `request` and assert it took exactly `expected` report-pool slots, then
 * return what it resolved. A page that promises one lake slot per request
 * wraps its call in this; a request refused before the lake expects none.
 */
export async function expectLakeSlots<T>(
  expected: number,
  request: () => Promise<T>,
): Promise<T> {
  const before = countReportSlotsTaken();
  const result = await request();
  expect(countReportSlotsTaken() - before).toBe(expected);
  return result;
}

/** A page's whole request took exactly one lake slot. */
export async function expectOneLakeSlot<T>(
  request: () => Promise<T>,
): Promise<T> {
  return await expectLakeSlots(1, request);
}
