import type { DiscordGuildId } from "@scout-for-lol/data";
import type * as AccessModule from "#src/consumer/access.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { afterAll, beforeAll, beforeEach, expect, vi } from "vitest";
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

/**
 * The replacement for `#src/consumer/access.ts` in which one named actor's
 * Discord membership cannot be asked, the one boundary the harness cannot make
 * unavailable. Use from a `vi.mock` factory; nothing is shared between tests,
 * so a test that outlives its timeout cannot change what the next one sees.
 */
export async function withUnavailableMembershipFor(
  actorDiscordId: string,
): Promise<typeof AccessModule> {
  const actual = await vi.importActual<typeof AccessModule>(
    "#src/consumer/access.ts",
  );
  return {
    ...actual,
    resolveConsumerGuildAccess: (...args) =>
      args[0].discordId === actorDiscordId
        ? Promise.resolve({ kind: "unavailable" as const })
        : actual.resolveConsumerGuildAccess(...args),
  };
}

/** Empty the tables a consumer profile test seeds, before each test. */
export async function clearConsumerProfileTables(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  await prisma.currentRankSnapshot.deleteMany();
  await prisma.matchRankHistory.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
}
