import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId } from "#src/testing/test-ids.ts";
import { eligibleTips } from "#src/tips/tip-eligibility.ts";
import {
  claimTip,
  lastTipShownAt,
  releaseTipClaim,
  shownTipKeys,
} from "#src/tips/tip-state.ts";
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
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

const { prisma: db } = createTestDatabase("feature-tip-eligibility");
const SERVER_ID = DiscordGuildIdSchema.parse("1200000000000000002");
const NOW = new Date("2030-01-01T00:00:00Z");
const CREATOR = DiscordAccountIdSchema.parse("100000000000000001");

const DARE_FLAGS = ["dares_enabled"] as const;

async function clearAll(): Promise<void> {
  await db.featureTipImpression.deleteMany();
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
  for (const flag of DARE_FLAGS) resetFlagOverrides(flag);
  await clearAll();
  await shutdownFeatureFlags();
  await db.$disconnect();
});

beforeEach(async () => {
  for (const flag of DARE_FLAGS) resetFlagOverrides(flag);
  await clearAll();
});

test("offers Dares only when their standalone flag is enabled", async () => {
  expect(await keys()).not.toContain("dares");
  addFlagOverride("dares_enabled", true, { server: SERVER_ID });
  expect(await keys()).toContain("dares");
  expect(await keys()).not.toContain("transfers");
});

describe("track-more-players", () => {
  test("one player subscribed in two channels still counts as one player", async () => {
    // Subscriptions are unique per (server, player, channel), so counting rows
    // would read a single player in two channels as a populated guild and
    // suppress the tip forever.
    await trackPlayer("jerred", [
      DiscordChannelIdSchema.parse("100000000000000010"),
      DiscordChannelIdSchema.parse("100000000000000011"),
    ]);
    expect(await keys()).toContain("track-more-players");
  });

  test("two distinct players suppress it", async () => {
    await trackPlayer("jerred", [
      DiscordChannelIdSchema.parse("100000000000000010"),
    ]);
    await trackPlayer("bryan", [
      DiscordChannelIdSchema.parse("100000000000000010"),
    ]);
    expect(await keys()).not.toContain("track-more-players");
  });
});

describe("tip claims", () => {
  test("only one of two concurrent claims for the same audience wins", async () => {
    // Two deliveries to one guild can read the same cooldown and shown-set
    // before either writes. The unique constraint is what stops both from
    // sending the same tip.
    const audience = { serverId: SERVER_ID };
    const [first, second] = await Promise.all([
      claimTip({ ...audience, tipKey: "competitions" }, db),
      claimTip({ ...audience, tipKey: "competitions" }, db),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await shownTipKeys(audience, db)).toEqual(new Set(["competitions"]));
  });

  test("serializes concurrent claims even when tip keys differ", async () => {
    const audience = { serverId: testGuildId("333000000000000003") };
    const [first, second] = await Promise.all([
      claimTip({ ...audience, tipKey: "competitions" }, db),
      claimTip({ ...audience, tipKey: "duels" }, db),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  test("a channel claim and a DM claim do not collide", async () => {
    const serverId = SERVER_ID;
    const discordId = DiscordAccountIdSchema.parse("100000000000000042");
    expect(await claimTip({ serverId, tipKey: "duels" }, db)).toBe(true);
    expect(await claimTip({ serverId, discordId, tipKey: "duels" }, db)).toBe(
      true,
    );
    expect(await shownTipKeys({ serverId }, db)).toEqual(new Set(["duels"]));
    expect(await shownTipKeys({ serverId, discordId }, db)).toEqual(
      new Set(["duels"]),
    );
  });

  test("releasing a claim makes the tip eligible again", async () => {
    const audience = { serverId: SERVER_ID };
    expect(await claimTip({ ...audience, tipKey: "dares" }, db)).toBe(true);
    await releaseTipClaim({ ...audience, tipKey: "dares" }, db);
    expect(await shownTipKeys(audience, db)).toEqual(new Set());
    expect(await claimTip({ ...audience, tipKey: "dares" }, db)).toBe(true);
  });
});

describe("persisted tip keys", () => {
  test("preserves retired history without making it eligible again", async () => {
    const audience = { serverId: SERVER_ID };
    const shownAt = new Date("2030-01-09T23:00:00Z");
    const retired = await db.featureTipImpression.create({
      data: {
        serverId: SERVER_ID,
        audienceId: "",
        tipKey: "tournament-lobbies",
        shownAt,
        claimedAt: null,
      },
    });
    const shown = await shownTipKeys(audience, db);
    expect(shown).toEqual(new Set(["tournament-lobbies"]));
    expect(await lastTipShownAt(audience, db)).toEqual(shownAt);
    const available = await eligibleTips({
      serverId: SERVER_ID,
      alreadyShown: shown,
      db,
    });
    expect(available.map(({ key }) => key)).not.toContain("tournament-lobbies");
    expect(available.map(({ key }) => key)).not.toContain("custom-nights");
    expect(
      await db.featureTipImpression.findUnique({ where: { id: retired.id } }),
    ).toEqual(retired);
  });

  test("every retired impression contributes to the latest timestamp", async () => {
    const audience = { serverId: SERVER_ID };
    await db.featureTipImpression.createMany({
      data: [
        {
          serverId: SERVER_ID,
          audienceId: "",
          tipKey: "custom-nights",
          shownAt: NOW,
          claimedAt: null,
        },
        {
          serverId: SERVER_ID,
          audienceId: "",
          tipKey: "tournament-lobbies",
          shownAt: new Date("2030-01-02T00:00:00Z"),
          claimedAt: null,
        },
      ],
    });
    expect(await shownTipKeys(audience, db)).toEqual(
      new Set(["custom-nights", "tournament-lobbies"]),
    );
    expect(await lastTipShownAt(audience, db)).toEqual(
      new Date("2030-01-02T00:00:00Z"),
    );
  });

  test("a corrupt tipKey fails loudly instead of occupying the shown set", async () => {
    // Malformed persisted data is an internal contract violation, not user
    // input: it must surface rather than silently suppress real tips.
    await db.featureTipImpression.create({
      data: { serverId: SERVER_ID, audienceId: "", tipKey: "not-a-real-tip" },
    });
    await expect(shownTipKeys({ serverId: SERVER_ID }, db)).rejects.toThrow(
      /Unknown persisted feature tip key/,
    );
    await expect(lastTipShownAt({ serverId: SERVER_ID }, db)).rejects.toThrow(
      /Unknown persisted feature tip key/,
    );
  });
});
