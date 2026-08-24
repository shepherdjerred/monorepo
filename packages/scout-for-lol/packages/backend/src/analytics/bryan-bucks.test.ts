import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  captureBucksMemberActivity,
  captureBucksLifecycle,
} from "#src/analytics/bryan-bucks.ts";
import type { ProductAnalytics } from "#src/analytics/product-analytics.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("bryan-bucks-analytics-test");
const SERVER_ID = testGuildId("920");
const DISCORD_ID = testAccountId("921");

function createAnalyticsFixture() {
  const captureBucksMember = vi.fn<ProductAnalytics["captureBucksMember"]>(
    () => null,
  );
  const captureBucksSystem = vi.fn<ProductAnalytics["captureBucksSystem"]>(
    () => null,
  );
  const analytics: ProductAnalytics = {
    capture: () => null,
    captureBucksMember,
    captureBucksSystem,
    shutdown: () => Promise.resolve(),
  };
  return { analytics, captureBucksMember, captureBucksSystem };
}

beforeEach(async () => {
  await prisma.bucksAccount.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Bryan Bucks analytics", () => {
  test("captures member activity with the opaque account identity", async () => {
    const account = await prisma.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: DISCORD_ID },
    });
    const { analytics, captureBucksMember } = createAnalyticsFixture();

    await captureBucksMemberActivity(
      {
        serverId: SERVER_ID,
        discordId: DISCORD_ID,
        activityKind: "outcome_bet",
        surface: "button",
        status: "success",
      },
      { db: prisma, analytics },
    );

    expect(captureBucksMember).toHaveBeenCalledWith(
      { analyticsUserId: account.analyticsUserId, serverId: SERVER_ID },
      {
        event: "bryan_bucks_member_activity",
        properties: {
          activity_kind: "outcome_bet",
          surface: "button",
          status: "success",
        },
      },
    );
    expect(JSON.stringify(captureBucksMember.mock.calls)).not.toContain(
      DISCORD_ID,
    );
  });

  test("does not put house accounts in member retention", async () => {
    await prisma.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: DISCORD_ID, isHouse: true },
    });
    const { analytics, captureBucksMember } = createAnalyticsFixture();

    await captureBucksMemberActivity(
      {
        serverId: SERVER_ID,
        discordId: DISCORD_ID,
        activityKind: "command",
        surface: "command",
        status: "success",
      },
      { db: prisma, analytics },
    );

    expect(captureBucksMember).not.toHaveBeenCalled();
  });

  test("captures lifecycle values without an account identity", () => {
    const { analytics, captureBucksSystem } = createAnalyticsFixture();

    captureBucksLifecycle({
      serverId: SERVER_ID,
      transition: "bucks.pool.settled",
      amountBucks: 20,
      matchedBucks: 15,
      payoutBucks: 32,
      balanceAfterBucks: 100,
      analytics,
    });

    expect(captureBucksSystem).toHaveBeenCalledWith(
      SERVER_ID,
      {
        event: "bryan_bucks_lifecycle",
        properties: {
          transition: "bucks.pool.settled",
          amount_bucks: 20,
          matched_bucks: 15,
          payout_bucks: 32,
          balance_after_bucks: 100,
        },
      },
      undefined,
    );
  });

  test("keeps PostHog failures non-fatal", async () => {
    const captureBucksMember = vi.fn<ProductAnalytics["captureBucksMember"]>(
      () => {
        throw new Error("PostHog unavailable");
      },
    );
    const analytics: ProductAnalytics = {
      capture: () => null,
      captureBucksMember,
      captureBucksSystem: () => null,
      shutdown: () => Promise.resolve(),
    };
    await prisma.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: DISCORD_ID },
    });

    await expect(
      captureBucksMemberActivity(
        {
          serverId: SERVER_ID,
          discordId: DISCORD_ID,
          activityKind: "command",
          surface: "command",
          status: "success",
        },
        { db: prisma, analytics },
      ),
    ).resolves.toBeUndefined();
  });
});
