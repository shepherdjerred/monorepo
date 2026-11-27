import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import { afterAll, beforeAll, beforeEach } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { resetConfigurationForTests } from "#src/configuration.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
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

/** A tracked player with one Riot account, as the consumer routes find them. */
export async function createTrackedPlayer(
  prisma: ExtendedPrismaClient,
  options: {
    guildId: DiscordGuildId;
    alias: string;
    puuid: LeaguePuuid;
    creatorDiscordId: DiscordAccountId;
    createdAt: Date;
    discordId?: DiscordAccountId;
  },
) {
  const row = await prisma.player.create({
    data: {
      serverId: options.guildId,
      alias: options.alias,
      creatorDiscordId: options.creatorDiscordId,
      ...(options.discordId === undefined
        ? {}
        : { discordId: options.discordId }),
      createdTime: options.createdAt,
      updatedTime: options.createdAt,
    },
  });
  await prisma.account.create({
    data: {
      serverId: options.guildId,
      playerId: row.id,
      alias: `${options.alias} account`,
      puuid: options.puuid,
      region: "AMERICA_NORTH",
      creatorDiscordId: options.creatorDiscordId,
      riotGameName: options.alias,
      riotTagLine: "NA1",
      createdTime: options.createdAt,
      updatedTime: options.createdAt,
    },
  });
  return row;
}
