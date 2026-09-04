import type { DiscordGuildId } from "@scout-for-lol/data";
import { afterAll, beforeAll, beforeEach } from "vitest";
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
import { resetTestLake } from "#src/testing/test-report-lake.ts";

const PLAYER_PROFILE_FLAG = "scout-consumer-player-profiles-enabled";

export function configureConsumerProfileFeatureTest(
  guildIds: DiscordGuildId[],
) {
  const previousEnvironment = Bun.env["ENVIRONMENT"];
  const previousAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  Bun.env["ENVIRONMENT"] = "beta";
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
