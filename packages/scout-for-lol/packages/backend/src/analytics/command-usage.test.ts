import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { captureDiscordCommandUsed } from "#src/analytics/command-usage.ts";
import type { ProductAnalytics } from "#src/analytics/product-analytics.ts";

const { prisma } = createTestDatabase("command-usage-analytics-test");
const SERVER_ID = testGuildId("880");

function createAnalyticsFixture() {
  const capture = vi.fn<ProductAnalytics["capture"]>(() => null);
  const shutdown = vi.fn<ProductAnalytics["shutdown"]>(() => Promise.resolve());
  return { analytics: { capture, shutdown }, capture };
}

async function seedInstall(options?: { analyticsLifecycleTracked?: boolean }) {
  return prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: "Command usage fixture",
      ownerDiscordId: testAccountId("881"),
      addedByDiscordId: testAccountId("881"),
      memberCount: 12,
      installedAt: new Date("2026-08-01T00:00:00Z"),
      analyticsLifecycleTracked: options?.analyticsLifecycleTracked ?? true,
    },
  });
}

beforeEach(async () => {
  await prisma.guildInstall.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("captureDiscordCommandUsed", () => {
  test("captures a known command against the guild installation identity", async () => {
    const install = await seedInstall();
    const { analytics, capture } = createAnalyticsFixture();

    await captureDiscordCommandUsed(
      { guildId: SERVER_ID, commandName: "track", status: "success" },
      { db: prisma, analytics },
    );

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: SERVER_ID,
        analyticsInstallationId: install.analyticsInstallationId,
      }),
      {
        event: "discord_command_used",
        properties: { command_name: "track", status: "success" },
      },
    );
  });

  test("captures error status for a failed command", async () => {
    await seedInstall();
    const { analytics, capture } = createAnalyticsFixture();

    await captureDiscordCommandUsed(
      { guildId: SERVER_ID, commandName: "scout", status: "error" },
      { db: prisma, analytics },
    );

    expect(capture).toHaveBeenCalledWith(expect.anything(), {
      event: "discord_command_used",
      properties: { command_name: "scout", status: "error" },
    });
  });

  test("skips DM invocations without touching the database", async () => {
    const { analytics, capture } = createAnalyticsFixture();

    await captureDiscordCommandUsed(
      { guildId: null, commandName: "help", status: "success" },
      { db: prisma, analytics },
    );

    expect(capture).not.toHaveBeenCalled();
  });

  test("skips command names outside the closed union", async () => {
    await seedInstall();
    const { analytics, capture } = createAnalyticsFixture();

    await captureDiscordCommandUsed(
      { guildId: SERVER_ID, commandName: "stale-command", status: "success" },
      { db: prisma, analytics },
    );

    expect(capture).not.toHaveBeenCalled();
  });

  test("skips malformed guild ids instead of throwing", async () => {
    const { analytics, capture } = createAnalyticsFixture();

    await captureDiscordCommandUsed(
      { guildId: "not-a-snowflake", commandName: "help", status: "success" },
      { db: prisma, analytics },
    );

    expect(capture).not.toHaveBeenCalled();
  });

  test("skips guilds without a GuildInstall lifecycle row", async () => {
    const { analytics, capture } = createAnalyticsFixture();

    await captureDiscordCommandUsed(
      { guildId: SERVER_ID, commandName: "list", status: "success" },
      { db: prisma, analytics },
    );

    expect(capture).not.toHaveBeenCalled();
  });

  test("still captures for legacy (untracked) lifecycle cohorts", async () => {
    await seedInstall({ analyticsLifecycleTracked: false });
    const { analytics, capture } = createAnalyticsFixture();

    await captureDiscordCommandUsed(
      { guildId: SERVER_ID, commandName: "bb", status: "success" },
      { db: prisma, analytics },
    );

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ analyticsLifecycleTracked: false }),
      expect.anything(),
    );
  });

  test("never throws when the capture transport fails", async () => {
    await seedInstall();
    const capture = vi.fn<ProductAnalytics["capture"]>(() => {
      throw new Error("transport down");
    });
    const analytics: ProductAnalytics = {
      capture,
      shutdown: () => Promise.resolve(),
    };

    await expect(
      captureDiscordCommandUsed(
        { guildId: SERVER_ID, commandName: "help", status: "success" },
        { db: prisma, analytics },
      ),
    ).resolves.toBeUndefined();
  });
});
