import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  completeInstallAttribution,
  mintInstallAttributionToken,
  reconcilePendingInstallAttribution,
} from "#src/analytics/install-attribution.ts";
import { createAnalyticsFixture } from "#src/testing/analytics-fixture.ts";

const { prisma } = createTestDatabase("install-attribution-test");
const SERVER_ID = testGuildId("770");
const INSTALLER = testAccountId("771");
const OTHER_USER = testAccountId("772");

const T0 = new Date("2026-08-22T12:00:00Z");
const T_PLUS_1M = new Date("2026-08-22T12:01:00Z");
const T_PLUS_5M = new Date("2026-08-22T12:05:00Z");
const T_PLUS_20M = new Date("2026-08-22T12:20:00Z");

async function seedInstall(options?: { installedAt?: Date }) {
  return prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: "Attribution fixture",
      ownerDiscordId: INSTALLER,
      addedByDiscordId: INSTALLER,
      memberCount: 25,
      installedAt: options?.installedAt ?? T_PLUS_1M,
    },
  });
}

async function mint(now: Date = T0) {
  return mintInstallAttributionToken(
    { discordId: INSTALLER, surface: "guild_picker" },
    { db: prisma, now },
  );
}

beforeEach(async () => {
  await prisma.installAttributionToken.deleteMany();
  await prisma.guildInstall.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("mintInstallAttributionToken", () => {
  test("persists a single-use token with a 15-minute TTL", async () => {
    const token = await mint();
    const row = await prisma.installAttributionToken.findUniqueOrThrow({
      where: { token },
    });
    expect(row.discordId).toBe(INSTALLER);
    expect(row.surface).toBe("guild_picker");
    expect(row.consumedAt).toBeNull();
    expect(row.expiresAt).toEqual(new Date(T0.getTime() + 15 * 60 * 1000));
  });

  test("prunes long-dead tokens on mint", async () => {
    const ancient = await mint(new Date("2026-08-01T00:00:00Z"));
    await mint(T0);
    const gone = await prisma.installAttributionToken.findUnique({
      where: { token: ancient },
    });
    expect(gone).toBeNull();
  });
});

describe("completeInstallAttribution", () => {
  test("attributes when the gateway already created the install", async () => {
    const install = await seedInstall();
    const token = await mint();
    const { analytics, capture } = createAnalyticsFixture();

    const result = await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );

    expect(result).toEqual({
      outcome: "attributed",
      guildId: SERVER_ID,
      surface: "guild_picker",
    });
    const updated = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(updated.attributedAt).toEqual(T_PLUS_5M);
    expect(updated.attributionSurface).toBe("guild_picker");
    const tokenRow = await prisma.installAttributionToken.findUniqueOrThrow({
      where: { token },
    });
    expect(tokenRow.consumedAt).toEqual(T_PLUS_5M);
    expect(tokenRow.reconciledAt).toEqual(T_PLUS_5M);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        analyticsInstallationId: install.analyticsInstallationId,
      }),
      {
        event: "guild_install_attributed",
        properties: {
          attribution_surface: "guild_picker",
          attribution_timing: "after_gateway",
        },
      },
    );
  });

  test("returns pending and stores the guild when the browser beats the gateway", async () => {
    const token = await mint();
    const { analytics, capture } = createAnalyticsFixture();

    const result = await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );

    expect(result.outcome).toBe("pending");
    expect(capture).not.toHaveBeenCalled();
    const tokenRow = await prisma.installAttributionToken.findUniqueOrThrow({
      where: { token },
    });
    expect(tokenRow.guildId).toBe(SERVER_ID);
    expect(tokenRow.consumedAt).toEqual(T_PLUS_5M);
    expect(tokenRow.reconciledAt).toBeNull();
  });

  test("rejects an expired token", async () => {
    const token = await mint(T0);
    const { analytics, capture } = createAnalyticsFixture();

    const result = await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_20M },
    );

    expect(result).toEqual({ outcome: "invalid" });
    expect(capture).not.toHaveBeenCalled();
  });

  test("rejects a replayed token", async () => {
    await seedInstall();
    const token = await mint();
    const { analytics } = createAnalyticsFixture();

    await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );
    const replay = await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );

    expect(replay).toEqual({ outcome: "invalid" });
  });

  test("rejects a token bound to a different user", async () => {
    const token = await mint();
    const { analytics } = createAnalyticsFixture();

    const result = await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: OTHER_USER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );

    expect(result).toEqual({ outcome: "invalid" });
  });

  test("burns the token on cancel without emitting", async () => {
    const token = await mint();
    const { analytics, capture } = createAnalyticsFixture();

    const result = await completeInstallAttribution(
      { state: token, guildId: undefined, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );

    expect(result).toEqual({ outcome: "cancelled" });
    expect(capture).not.toHaveBeenCalled();
    const replay = await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );
    expect(replay).toEqual({ outcome: "invalid" });
  });

  test("refuses to attribute an install that predates the token", async () => {
    await seedInstall({ installedAt: new Date("2026-08-01T00:00:00Z") });
    const token = await mint();
    const { analytics, capture } = createAnalyticsFixture();

    const result = await completeInstallAttribution(
      { state: token, guildId: SERVER_ID, discordId: INSTALLER },
      { db: prisma, analytics, now: T_PLUS_5M },
    );

    expect(result.outcome).toBe("already_installed");
    expect(capture).not.toHaveBeenCalled();
    const untouched = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(untouched.attributedAt).toBeNull();
  });
});

async function consumePending(token: string) {
  const { analytics } = createAnalyticsFixture();
  await completeInstallAttribution(
    { state: token, guildId: SERVER_ID, discordId: INSTALLER },
    { db: prisma, analytics, now: T_PLUS_1M },
  );
}

describe("reconcilePendingInstallAttribution", () => {
  test("completes a pending attribution once the gateway catches up", async () => {
    const token = await mint();
    await consumePending(token);
    const install = await seedInstall({ installedAt: T_PLUS_5M });
    const { analytics, capture } = createAnalyticsFixture();

    await reconcilePendingInstallAttribution(SERVER_ID, {
      db: prisma,
      analytics,
      now: T_PLUS_5M,
    });

    const updated = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(updated.attributedAt).toEqual(T_PLUS_5M);
    expect(updated.attributionSurface).toBe("guild_picker");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        analyticsInstallationId: install.analyticsInstallationId,
      }),
      {
        event: "guild_install_attributed",
        properties: {
          attribution_surface: "guild_picker",
          attribution_timing: "before_gateway",
        },
      },
    );
  });

  test("emits exactly one event when both sides run", async () => {
    const token = await mint();
    await consumePending(token);
    await seedInstall({ installedAt: T_PLUS_5M });
    const { analytics, capture } = createAnalyticsFixture();

    await reconcilePendingInstallAttribution(SERVER_ID, {
      db: prisma,
      analytics,
      now: T_PLUS_5M,
    });
    await reconcilePendingInstallAttribution(SERVER_ID, {
      db: prisma,
      analytics,
      now: T_PLUS_5M,
    });

    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("ignores tokens older than the reconcile window", async () => {
    const token = await mint();
    await consumePending(token);
    await seedInstall({ installedAt: T_PLUS_5M });
    const { analytics, capture } = createAnalyticsFixture();

    await reconcilePendingInstallAttribution(SERVER_ID, {
      db: prisma,
      analytics,
      now: new Date("2026-08-25T12:00:00Z"),
    });

    expect(capture).not.toHaveBeenCalled();
  });

  test("does nothing when no pending token names the guild", async () => {
    await seedInstall();
    const { analytics, capture } = createAnalyticsFixture();

    await reconcilePendingInstallAttribution(SERVER_ID, {
      db: prisma,
      analytics,
      now: T_PLUS_5M,
    });

    expect(capture).not.toHaveBeenCalled();
  });
});
