import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testGuildId, testAccountId } from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  captureFirstSubscriptionCreated,
  captureGuildRemoval,
  deliverTrackedCoreOutput,
  memberCountBucket,
  recordCoreOutputDelivered,
  removalActivationState,
  tenureBucket,
} from "#src/analytics/guild-lifecycle.ts";
import type { ProductAnalytics } from "#src/analytics/product-analytics.ts";

const { prisma } = createTestDatabase("guild-lifecycle-analytics-test");
const SERVER_ID = testGuildId("780");

function createAnalyticsFixture() {
  const capture = mock<ProductAnalytics["capture"]>(() => null);
  const shutdown = mock<ProductAnalytics["shutdown"]>(() => Promise.resolve());
  return { analytics: { capture, shutdown }, capture, shutdown };
}

async function seedInstall(options?: {
  analyticsLifecycleTracked?: boolean;
  installedAt?: Date;
  firstCoreOutputAt?: Date;
}) {
  return prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: "Lifecycle fixture",
      ownerDiscordId: testAccountId("781"),
      addedByDiscordId: testAccountId("781"),
      memberCount: 42,
      installedAt: options?.installedAt ?? new Date("2026-08-01T00:00:00Z"),
      analyticsLifecycleTracked: options?.analyticsLifecycleTracked ?? true,
      ...(options?.firstCoreOutputAt === undefined
        ? {}
        : { firstCoreOutputAt: options.firstCoreOutputAt }),
    },
  });
}

describe("guild lifecycle analytics state", () => {
  beforeEach(async () => {
    await prisma.guildInstall.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("assigns unique opaque installation identities to new rows", async () => {
    const first = await seedInstall();
    const second = await prisma.guildInstall.create({
      data: {
        serverId: testGuildId("782"),
        serverName: "Second lifecycle fixture",
        ownerDiscordId: testAccountId("783"),
        addedByDiscordId: testAccountId("783"),
        memberCount: 5,
        installedAt: new Date(),
      },
    });

    expect(first.analyticsInstallationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.analyticsInstallationId).not.toBe(
      second.analyticsInstallationId,
    );
    expect(first.analyticsLifecycleTracked).toBe(true);
  });

  test.each(["web", "discord"] as const)(
    "captures the committed first subscription from %s with only its surface",
    async (surface) => {
      await seedInstall();
      const { analytics, capture } = createAnalyticsFixture();

      await captureFirstSubscriptionCreated(
        SERVER_ID,
        surface,
        prisma,
        analytics,
      );

      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({ analyticsLifecycleTracked: true }),
        {
          event: "first_subscription_created",
          properties: { surface },
        },
      );
    },
  );

  test("atomically emits one first-output marker across concurrent deliveries", async () => {
    await seedInstall();
    const { analytics, capture } = createAnalyticsFixture();

    await Promise.all([
      recordCoreOutputDelivered(SERVER_ID, "prematch", {
        db: prisma,
        analytics,
        deliveredAt: new Date("2026-08-02T00:00:00Z"),
      }),
      recordCoreOutputDelivered(SERVER_ID, "postmatch", {
        db: prisma,
        analytics,
        deliveredAt: new Date("2026-08-02T00:01:00Z"),
      }),
    ]);

    const calls = capture.mock.calls;
    expect(
      calls.filter(([, event]) => event.event === "core_output_delivered"),
    ).toHaveLength(2);
    expect(
      calls.filter(
        ([, event]) => event.event === "first_core_output_delivered",
      ),
    ).toHaveLength(1);
    const install = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(install?.firstCoreOutputAt).not.toBeNull();
  });

  test("does not synthesize a first-output event for a migrated lifecycle", async () => {
    await seedInstall({ analyticsLifecycleTracked: false });
    const { analytics, capture } = createAnalyticsFixture();

    await recordCoreOutputDelivered(SERVER_ID, "report_scheduled", {
      db: prisma,
      analytics,
    });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ analyticsLifecycleTracked: false }),
      {
        event: "core_output_delivered",
        properties: { output_kind: "report_scheduled" },
      },
    );
  });

  test("records a multi-chunk output only after every chunk succeeds", async () => {
    await seedInstall();
    const { analytics, capture } = createAnalyticsFixture();
    const deliveredChunks: string[] = [];

    await deliverTrackedCoreOutput({
      serverId: SERVER_ID,
      outputKind: "report_manual",
      db: prisma,
      analytics,
      async deliver() {
        for (const chunk of ["first", "second", "third"]) {
          deliveredChunks.push(chunk);
        }
      },
    });

    expect(deliveredChunks).toEqual(["first", "second", "third"]);
    expect(capture).toHaveBeenCalledWith(expect.anything(), {
      event: "core_output_delivered",
      properties: { output_kind: "report_manual" },
    });
  });

  test("does not record a multi-chunk output when a later chunk fails", async () => {
    await seedInstall();
    const { analytics, capture } = createAnalyticsFixture();

    await expect(
      deliverTrackedCoreOutput({
        serverId: SERVER_ID,
        outputKind: "pairing_weekly",
        db: prisma,
        analytics,
        async deliver() {
          await Promise.resolve();
          throw new Error("second chunk failed");
        },
      }),
    ).rejects.toThrow("second chunk failed");

    expect(capture).not.toHaveBeenCalled();
    const install = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(install?.firstCoreOutputAt).toBeNull();
  });

  test("claims a removal once and classifies it before cleanup", async () => {
    await seedInstall({ firstCoreOutputAt: new Date("2026-08-03T00:00:00Z") });
    const { analytics, capture } = createAnalyticsFixture();
    const removedAt = new Date("2026-08-10T00:00:00Z");

    expect(
      await captureGuildRemoval(SERVER_ID, removedAt, prisma, analytics),
    ).toBe(true);
    expect(
      await captureGuildRemoval(SERVER_ID, removedAt, prisma, analytics),
    ).toBe(false);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(expect.anything(), {
      event: "guild_removed",
      properties: {
        activation_state: "activated",
        tenure_bucket: "7-29d",
      },
    });
  });
});

describe("bounded lifecycle buckets", () => {
  test.each([
    [1, "1-10"],
    [10, "1-10"],
    [11, "11-50"],
    [51, "51-250"],
    [251, "251-1000"],
    [1001, "1001+"],
  ] as const)("buckets %i members as %s", (members, expected) => {
    expect(memberCountBucket(members)).toBe(expected);
  });

  test.each([
    [0, "<1d"],
    [1, "1-6d"],
    [7, "7-29d"],
    [30, "30-89d"],
    [90, "90d+"],
  ] as const)("buckets %i days as %s", (days, expected) => {
    const installedAt = new Date("2026-01-01T00:00:00Z");
    const removedAt = new Date(installedAt.getTime() + days * 86_400_000);
    expect(tenureBucket(installedAt, removedAt)).toBe(expected);
  });

  test.each([
    {
      input: {
        firstCoreOutputAt: null,
        subscriptions: 0,
        reports: 0,
        competitions: 0,
      },
      expected: "installed_only",
    },
    {
      input: {
        firstCoreOutputAt: null,
        subscriptions: 1,
        reports: 0,
        competitions: 0,
      },
      expected: "configured",
    },
    {
      input: {
        firstCoreOutputAt: null,
        subscriptions: 0,
        reports: 1,
        competitions: 0,
      },
      expected: "configured",
    },
    {
      input: {
        firstCoreOutputAt: null,
        subscriptions: 0,
        reports: 0,
        competitions: 1,
      },
      expected: "configured",
    },
    {
      input: {
        firstCoreOutputAt: new Date(),
        subscriptions: 0,
        reports: 0,
        competitions: 0,
      },
      expected: "activated",
    },
  ] as const)(
    "classifies removal activation state as $expected",
    ({ input, expected }) => {
      expect(removalActivationState(input)).toBe(expected);
    },
  );
});
