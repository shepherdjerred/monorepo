import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { FEATURE_TIPS } from "#src/tips/tip-catalog.ts";
import { eligibleTips } from "#src/tips/tip-eligibility.ts";

const { prisma: db } = createTestDatabase("feature-tip-eligibility");
const SERVER_ID = DiscordGuildIdSchema.parse("1200000000000000002");
const NOW = new Date("2030-01-01T00:00:00Z");
const CREATOR = DiscordAccountIdSchema.parse("100000000000000001");

const BUCKS_FLAGS = [
  "betting_enabled",
  "bucks_dares_enabled",
  "bucks_transfers_enabled",
] as const;

async function clearAll(): Promise<void> {
  await db.subscription.deleteMany();
  await db.player.deleteMany();
}

async function trackPlayer(
  alias: string,
  channelIds: readonly string[],
): Promise<void> {
  const player = await db.player.create({
    data: {
      alias,
      serverId: SERVER_ID,
      creatorDiscordId: CREATOR,
      createdTime: NOW,
      updatedTime: NOW,
    },
  });
  for (const channelId of channelIds) {
    await db.subscription.create({
      data: {
        playerId: player.id,
        channelId: DiscordChannelIdSchema.parse(channelId),
        serverId: SERVER_ID,
        creatorDiscordId: CREATOR,
        createdTime: NOW,
        updatedTime: NOW,
      },
    });
  }
}

async function keys(): Promise<string[]> {
  const tips = await eligibleTips({
    serverId: SERVER_ID,
    alreadyShown: new Set<string>(),
    db,
  });
  return tips.map((tip) => tip.key);
}

beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
});

afterAll(async () => {
  for (const flag of BUCKS_FLAGS) resetFlagOverrides(flag);
  await clearAll();
  await shutdownFeatureFlags();
  await db.$disconnect();
});

beforeEach(async () => {
  for (const flag of BUCKS_FLAGS) resetFlagOverrides(flag);
  await clearAll();
});

describe("track-more-players", () => {
  test("one player subscribed in two channels still counts as one player", async () => {
    // Subscriptions are unique per (server, player, channel), so counting rows
    // would read a single player in two channels as a populated guild and
    // suppress the tip forever.
    await trackPlayer("jerred", ["100000000000000010", "100000000000000011"]);
    expect(await keys()).toContain("track-more-players");
  });

  test("two distinct players suppress it", async () => {
    await trackPlayer("jerred", ["100000000000000010"]);
    await trackPlayer("bryan", ["100000000000000010"]);
    expect(await keys()).not.toContain("track-more-players");
  });
});

describe("Bucks tip availability", () => {
  test("needs the feature's own flag AND the parent betting flag", async () => {
    addFlagOverride("bucks_dares_enabled", true, { server: SERVER_ID });
    addFlagOverride("bucks_transfers_enabled", true, { server: SERVER_ID });
    // `/bb dare` and `/bb transfer` both reject while betting is shut down, so
    // advertising them then would point at an action that fails.
    const withoutParent = await keys();
    expect(withoutParent).not.toContain("dares");
    expect(withoutParent).not.toContain("transfers");

    addFlagOverride("betting_enabled", true, { server: SERVER_ID });
    const withParent = await keys();
    expect(withParent).toContain("dares");
    expect(withParent).toContain("transfers");
  });

  test("every Bucks tip names the parent betting flag", () => {
    for (const key of ["dares", "transfers"] as const) {
      const tip = FEATURE_TIPS.find((candidate) => candidate.key === key);
      expect(tip?.flags).toContain("betting_enabled");
    }
  });
});
