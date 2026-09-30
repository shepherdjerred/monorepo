/**
 * GuildInstall bookkeeping in handleGuildCreate.
 *
 * The behaviour under test is the anti-spam invariant: a `guildCreate` for a
 * guild we never left must NOT restart onboarding, because doing so re-arms the
 * onboarding DMs and falsifies `installedAt` for a long-standing server. Only a
 * removal we actually observed (`removedAt`) makes it a genuine re-install.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { ChannelType } from "discord.js";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { mockGuild, mockTextChannel } from "#src/testing/discord-mocks.ts";
import { testGuildId, testAccountId } from "#src/testing/test-ids.ts";
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";
import type { GuildInstallReplacement } from "#src/discord/events/guild-create.ts";

const { prisma } = createTestDatabase("guild-create-install-test");

const databaseModule = await import("#src/database/index.ts");
vi.doMock("#src/database/index.ts", () => ({
  ...databaseModule,
  prisma,
}));

// Stubbed so concurrent-install tests can assert call counts without
// touching the real product analytics singleton (network/PostHog init).
const guildLifecycleModule = await import("#src/analytics/guild-lifecycle.ts");
const captureGuildInstalled =
  vi.fn<typeof guildLifecycleModule.captureGuildInstalled>();
vi.doMock("#src/analytics/guild-lifecycle.ts", () => ({
  ...guildLifecycleModule,
  captureGuildInstalled,
}));

const installAttributionModule =
  await import("#src/analytics/install-attribution.ts");
const reconcilePendingInstallAttribution =
  vi.fn<typeof installAttributionModule.reconcilePendingInstallAttribution>();
const retirePendingInstallAttribution =
  vi.fn<typeof installAttributionModule.retirePendingInstallAttribution>();
const retirePendingInstallAttributionInTransaction =
  vi.fn<
    typeof installAttributionModule.retirePendingInstallAttributionInTransaction
  >();
const restoreRetiredInstallAttribution =
  vi.fn<typeof installAttributionModule.restoreRetiredInstallAttribution>();
vi.doMock("#src/analytics/install-attribution.ts", () => ({
  ...installAttributionModule,
  reconcilePendingInstallAttribution,
  retirePendingInstallAttribution,
  retirePendingInstallAttributionInTransaction,
  restoreRetiredInstallAttribution,
}));

const { handleGuildCreate, saveGuildInstall } =
  await import("#src/discord/events/guild-create.ts");
const { reconcileConnectedGuildInstalls } =
  await import("#src/discord/events/guild-install-reconciliation.ts");

const SERVER_ID = testGuildId("500");

function guildFixture(
  send = vi.fn(() => Promise.resolve({})),
): ReturnType<typeof mockGuild> {
  return mockGuild({
    name: "Fixture Server",
    id: SERVER_ID,
    memberCount: 42,
    ownerId: testAccountId("77"),
    systemChannel: mockTextChannel({
      type: ChannelType.GuildText,
      name: "general",
      permissionsFor: vi.fn(() => ({ has: vi.fn(() => true) })),
      send,
    }),
    channels: { fetch: vi.fn(() => Promise.resolve(new Map())) },
    members: { me: { id: testAccountId("999") } },
    client: { user: { id: testAccountId("999") } },
  });
}

async function reconcileWhileGuildLeaves(connectedChecks = 2): Promise<void> {
  const guild = guildFixture();
  let checks = 0;
  await reconcileConnectedGuildInstalls([guild], {
    getConnectedGuild: () => {
      checks += 1;
      return checks <= connectedChecks ? guild : undefined;
    },
  });
}

async function expectReplacementClaimRetry(params: {
  readonly analyticsInstallationId: string;
  readonly replacement: GuildInstallReplacement;
}): Promise<void> {
  const guild = guildFixture();
  await prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: guild.name,
      ownerDiscordId: testAccountId("77"),
      addedByDiscordId: testAccountId("77"),
      memberCount: guild.memberCount,
      installedAt: new Date(),
      analyticsInstallationId: params.analyticsInstallationId,
      analyticsLifecycleTracked: false,
    },
  });
  const acceptReplacement = vi.fn();
  const claimReplacement = vi.fn(() => ({
    replacement: params.replacement,
    update: vi.fn(() => true),
    accept: acceptReplacement,
  }));
  const waitBeforeRetry = vi.fn(() => Promise.resolve());

  await reconcileConnectedGuildInstalls([guild], {
    getConnectedGuild: () => guild,
    claimReplacement,
    waitBeforeRetry,
  });

  expect(acceptReplacement).not.toHaveBeenCalled();
  expect(waitBeforeRetry.mock.calls).toEqual([[250], [1000]]);
  await expect(
    prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
  ).resolves.toMatchObject({
    analyticsInstallationId: params.analyticsInstallationId,
    analyticsLifecycleTracked: false,
  });

  await reconcileConnectedGuildInstalls([guild], {
    getConnectedGuild: () => guild,
    claimReplacement,
  });

  expect(acceptReplacement).toHaveBeenCalledTimes(1);
  await expect(
    prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
  ).resolves.toMatchObject({ analyticsLifecycleTracked: true });
}

beforeEach(async () => {
  await prisma.guildInstall.deleteMany();
  captureGuildInstalled.mockClear();
  reconcilePendingInstallAttribution.mockClear();
  retirePendingInstallAttribution.mockClear();
  retirePendingInstallAttribution.mockResolvedValue({
    tokenIds: [101],
    retiredAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  retirePendingInstallAttributionInTransaction.mockClear();
  retirePendingInstallAttributionInTransaction.mockResolvedValue({
    tokenIds: [101],
    retiredAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  restoreRetiredInstallAttribution.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reconcileConnectedGuildInstalls — bounded retries", () => {
  it("backfills a historical guild and retries failed token retirement", async () => {
    retirePendingInstallAttribution.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const waitBeforeRetry = vi.fn(() => Promise.resolve());
    await reconcileConnectedGuildInstalls([guildFixture()], {
      waitBeforeRetry,
    });

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(row).toMatchObject({
      serverId: SERVER_ID,
      serverName: "Fixture Server",
      ownerDiscordId: testAccountId("77"),
      addedByDiscordId: testAccountId("77"),
      memberCount: 42,
      analyticsLifecycleTracked: false,
      removedAt: null,
    });
    expect(captureGuildInstalled).not.toHaveBeenCalled();
    expect(retirePendingInstallAttribution).toHaveBeenCalledTimes(2);
    expect(waitBeforeRetry).toHaveBeenCalledExactlyOnceWith(250);
  });

  it("retries a transient ready-time backfill failure", async () => {
    vi.spyOn(prisma.guildInstall, "findUnique").mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const waitBeforeRetry = vi.fn(() => Promise.resolve());

    await reconcileConnectedGuildInstalls([guildFixture()], {
      waitBeforeRetry,
    });

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({
      analyticsLifecycleTracked: false,
      removedAt: null,
    });
    expect(waitBeforeRetry).toHaveBeenCalledExactlyOnceWith(250);
  });
});

describe("handleGuildCreate — GuildInstall bookkeeping", () => {
  it("does not alter an existing guild during connection reconciliation", async () => {
    const installedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Original name",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("88"),
        memberCount: 10,
        installedAt,
      },
    });

    await reconcileConnectedGuildInstalls([guildFixture()]);

    const row = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(row.serverName).toBe("Original name");
    expect(row.addedByDiscordId).toBe(testAccountId("88"));
    expect(row.installedAt).toEqual(installedAt);
    expect(reconcilePendingInstallAttribution).toHaveBeenCalledWith(SERVER_ID);
  });

  it("restores a removed guild and retries attribution after promotion", async () => {
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        removedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    reconcilePendingInstallAttribution.mockImplementationOnce(async () => {
      expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
      await expect(
        prisma.guildInstall.findUniqueOrThrow({
          where: { serverId: SERVER_ID },
        }),
      ).resolves.toMatchObject({ analyticsLifecycleTracked: true });
    });

    await reconcileConnectedGuildInstalls([guildFixture()]);

    const row = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(row.removedAt).toBeNull();
    expect(row.analyticsLifecycleTracked).toBe(true);
    expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
    expect(captureGuildInstalled.mock.calls[0]?.[1]).toBe("reinstall");
    expect(reconcilePendingInstallAttribution).toHaveBeenCalledWith(SERVER_ID);
    expect(retirePendingInstallAttributionInTransaction).toHaveBeenCalledWith(
      SERVER_ID,
      expect.any(Object),
    );
  });

  it("retries a recovered guild when attribution retirement fails", async () => {
    const previousRemovedAt = new Date("2026-02-01T00:00:00.000Z");
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        removedAt: previousRemovedAt,
      },
    });
    const original = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    retirePendingInstallAttributionInTransaction
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"));
    const waitBeforeRetry = vi.fn(() => Promise.resolve());

    await reconcileConnectedGuildInstalls([guildFixture()], {
      waitBeforeRetry,
    });

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({
      removedAt: previousRemovedAt,
      analyticsInstallationId: original.analyticsInstallationId,
      analyticsLifecycleTracked: true,
    });
    expect(captureGuildInstalled).not.toHaveBeenCalled();
    expect(reconcilePendingInstallAttribution).not.toHaveBeenCalled();
    expect(waitBeforeRetry.mock.calls).toEqual([[250], [1000]]);

    await reconcileConnectedGuildInstalls([guildFixture()]);

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({
      removedAt: null,
      analyticsLifecycleTracked: true,
    });
    expect(retirePendingInstallAttributionInTransaction).toHaveBeenCalledTimes(
      4,
    );
    expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
    expect(reconcilePendingInstallAttribution).toHaveBeenCalledTimes(1);
  });

  it("does not backfill an unavailable guild", async () => {
    const guild = guildFixture();
    Object.defineProperty(guild, "available", { value: false });

    await reconcileConnectedGuildInstalls([guild]);

    await expect(
      prisma.guildInstall.findUnique({ where: { serverId: SERVER_ID } }),
    ).resolves.toBeNull();
  });

  it("records a first install with a fresh outreach slate", async () => {
    await handleGuildCreate(guildFixture());

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(row).not.toBeNull();
    expect(row?.outreach3dSentAt).toBeNull();
    expect(row?.removedAt).toBeNull();
    expect(row?.analyticsInstallationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(row?.analyticsLifecycleTracked).toBe(true);
    expect(row?.firstCoreOutputAt).toBeNull();
  });

  it("preserves outreach progress when the guild was never removed", async () => {
    const originalInstall = new Date("2026-01-01T00:00:00.000Z");
    const sentAt = new Date("2026-01-04T10:00:00.000Z");
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: originalInstall,
        outreach3dSentAt: sentAt,
        outreach14dSentAt: sentAt,
        outreach30dSentAt: sentAt,
        firstSubscriptionAt: sentAt,
      },
    });

    const originalRow = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    const originalAnalyticsInstallationId =
      originalRow?.analyticsInstallationId;
    await handleGuildCreate(guildFixture());

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    // The whole point: no reset, so the outreach ladder cannot replay.
    expect(row?.outreach3dSentAt).toEqual(sentAt);
    expect(row?.outreach14dSentAt).toEqual(sentAt);
    expect(row?.outreach30dSentAt).toEqual(sentAt);
    expect(row?.installedAt).toEqual(originalInstall);
    expect(row?.analyticsInstallationId).toBe(originalAnalyticsInstallationId);
    // A guild we never left keeps its first-subscription claim too.
    expect(row?.firstSubscriptionAt).toEqual(sentAt);
    // Identity fields still refresh (name/member count can legitimately change).
    expect(row?.memberCount).toBe(42);
    expect(reconcilePendingInstallAttribution).toHaveBeenCalledWith(SERVER_ID);
  });
});

describe("handleGuildCreate — lifecycle transitions", () => {
  it("keeps an availability restore out of the install lifecycle", async () => {
    const installedAt = new Date("2026-01-01T00:00:00.000Z");
    const original = await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt,
        analyticsLifecycleTracked: false,
      },
    });

    await handleGuildCreate(guildFixture());

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({
      analyticsInstallationId: original.analyticsInstallationId,
      analyticsLifecycleTracked: false,
      installedAt,
      removedAt: null,
    });
    expect(captureGuildInstalled).not.toHaveBeenCalled();
  });

  it("restarts onboarding after a genuine re-install and clears removedAt", async () => {
    const sentAt = new Date("2026-01-04T10:00:00.000Z");
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        outreach3dSentAt: sentAt,
        outreach14dSentAt: sentAt,
        outreach30dSentAt: sentAt,
        removedAt: new Date("2026-02-01T00:00:00.000Z"),
        firstSubscriptionAt: sentAt,
      },
    });

    const originalRow = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    const originalAnalyticsInstallationId =
      originalRow?.analyticsInstallationId;
    await handleGuildCreate(guildFixture());

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(row?.outreach3dSentAt).toBeNull();
    expect(row?.outreach14dSentAt).toBeNull();
    // The 30-day column used to be left set on re-install because it was added
    // after the reset was written; it must reset with the others.
    expect(row?.outreach30dSentAt).toBeNull();
    expect(row?.removedAt).toBeNull();
    expect(row?.analyticsInstallationId).not.toBe(
      originalAnalyticsInstallationId,
    );
    expect(row?.analyticsLifecycleTracked).toBe(true);
    expect(row?.firstCoreOutputAt).toBeNull();
    // A stale claim from the OLD installation must not silently suppress the
    // new installation's first_subscription_created event.
    expect(row?.firstSubscriptionAt).toBeNull();
    expect(row?.installedAt.getTime()).toBeGreaterThan(
      new Date("2026-01-01T00:00:00.000Z").getTime(),
    );
  });

  it("restarts the ladder on re-install by moving installedAt forward", async () => {
    // Outreach state is derived from audit rows created after `installedAt`,
    // so advancing that timestamp resets budget, rung, and feedback status at
    // once. The previous model needed each counter cleared by hand, and missing
    // one left a re-installed server permanently budget-exhausted.
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        emailNudgeSentAt: new Date("2026-01-20T00:00:00.000Z"),
        removedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    // Three deliveries under the PREVIOUS installation.
    for (let i = 0; i < 3; i += 1) {
      await prisma.dmAuditLog.create({
        data: {
          recipientId: testAccountId("77"),
          guildId: SERVER_ID,
          kind: "outreach_nudge",
          content: "prior",
          deliveryStatus: "sent",
          ladderStage: i + 1,
          createdAt: new Date("2026-01-10T00:00:00.000Z"),
        },
      });
    }

    await handleGuildCreate(guildFixture());

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(row?.emailNudgeSentAt).toBeNull();
    const state = await readOutreachState(
      prisma,
      SERVER_ID,
      row?.installedAt ?? new Date(),
    );
    expect(state.spent).toBe(0);
    expect(state.lastLadderStage).toBe(0);
    expect(state.feedbackRequested).toBe(false);
  });
});

describe("handleGuildCreate — deferred historical availability", () => {
  it("backfills without onboarding when an unavailable guild becomes available", async () => {
    const send = vi.fn(() => Promise.resolve({}));
    const guild = guildFixture(send);
    Object.defineProperty(guild.client, "guilds", {
      value: { cache: new Map([[SERVER_ID, guild]]) },
    });

    await reconcileConnectedGuildInstalls([guild], {
      getConnectedGuild: (guildId) => guild.client.guilds.cache.get(guildId),
    });

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({ analyticsLifecycleTracked: false });
    expect(send).not.toHaveBeenCalled();
    expect(captureGuildInstalled).not.toHaveBeenCalled();
  });
});

describe("handleGuildCreate — displaced snapshot handoff", () => {
  it("registers a replacement that appears between the removal checks", async () => {
    const snapshotGuild = guildFixture();
    const replacementGuild = guildFixture();
    const registerReplacement = vi.fn();
    let checks = 0;

    await reconcileConnectedGuildInstalls([snapshotGuild], {
      getConnectedGuild: () => {
        checks += 1;
        if (checks <= 3) {
          return snapshotGuild;
        }
        return checks === 4 ? undefined : replacementGuild;
      },
      registerReplacement,
    });

    const historicalInstall = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(registerReplacement).toHaveBeenCalledExactlyOnceWith(
      replacementGuild,
      {
        kind: "reconciliation",
        analyticsInstallationId: historicalInstall.analyticsInstallationId,
        retiredAttribution: {
          tokenIds: [101],
          retiredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    );
    expect(historicalInstall).toMatchObject({
      analyticsLifecycleTracked: false,
      removedAt: null,
    });
  });
});

describe("handleGuildCreate — availability guard and concurrent races", () => {
  it("does not backfill a guild that left after the ready snapshot", async () => {
    const connectedGuilds = new Map<string, ReturnType<typeof mockGuild>>();
    await reconcileConnectedGuildInstalls([guildFixture()], {
      getConnectedGuild: (guildId) => connectedGuilds.get(guildId),
    });
    await expect(
      prisma.guildInstall.findUnique({ where: { serverId: SERVER_ID } }),
    ).resolves.toBeNull();
  });

  it("marks a backfill removed when the guild leaves during its write", async () => {
    await reconcileWhileGuildLeaves();

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({ removedAt: expect.any(Date) });
  });

  it("still checks for departure when historical token retirement fails", async () => {
    retirePendingInstallAttribution.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await reconcileWhileGuildLeaves(3);

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({ removedAt: expect.any(Date) });
  });

  it.each([
    {
      source: "initial backfill",
      createExisting: false,
      failFirstRetirement: false,
      failReplacementSave: false,
    },
    {
      source: "retirement retry",
      createExisting: true,
      failFirstRetirement: false,
      failReplacementSave: false,
    },
    {
      source: "failed retirement handoff",
      createExisting: true,
      failFirstRetirement: true,
      failReplacementSave: true,
    },
  ])(
    "lets a later ready snapshot finalize its exact handoff during $source",
    async ({ createExisting, failFirstRetirement, failReplacementSave }) => {
      const snapshotGuild = guildFixture();
      const replacementGuild = guildFixture();
      if (createExisting) {
        await prisma.guildInstall.create({
          data: {
            serverId: SERVER_ID,
            serverName: snapshotGuild.name,
            ownerDiscordId: testAccountId("77"),
            addedByDiscordId: testAccountId("77"),
            memberCount: snapshotGuild.memberCount,
            installedAt: new Date("2026-01-01T00:00:00.000Z"),
            analyticsLifecycleTracked: false,
          },
        });
      }
      let checks = 0;
      let replacementClaim: GuildInstallReplacement | undefined;
      if (failFirstRetirement) {
        retirePendingInstallAttribution
          .mockRejectedValueOnce(new Error("database unavailable"))
          .mockRejectedValueOnce(new Error("database unavailable"));
      }

      await reconcileConnectedGuildInstalls([snapshotGuild], {
        getConnectedGuild: () => {
          checks += 1;
          return checks <= 3 ? snapshotGuild : replacementGuild;
        },
        registerReplacement: (_guild, claim) => {
          replacementClaim = claim;
        },
      });

      const historicalInstall = await prisma.guildInstall.findUniqueOrThrow({
        where: { serverId: SERVER_ID },
      });
      expect(historicalInstall).toMatchObject({
        analyticsLifecycleTracked: false,
        removedAt: null,
      });
      expect(retirePendingInstallAttribution).toHaveBeenCalledWith(SERVER_ID);
      if (replacementClaim === undefined) {
        throw new Error("Expected replacement reconciliation claim");
      }
      const acceptedReplacement = replacementClaim;

      const acceptReplacement = vi.fn();
      let currentReplacement = acceptedReplacement;
      const updateReplacement = vi.fn(
        (updatedReplacement: GuildInstallReplacement) => {
          currentReplacement = updatedReplacement;
          return true;
        },
      );
      const claimReplacement = vi.fn(() => ({
        replacement: currentReplacement,
        update: updateReplacement,
        accept: acceptReplacement,
      }));
      const waitBeforeRetry = vi.fn(() => Promise.resolve());
      if (failReplacementSave) {
        vi.spyOn(prisma.guildInstall, "updateMany")
          .mockRejectedValueOnce(new Error("database unavailable"))
          .mockRejectedValueOnce(new Error("database unavailable"));
      }
      await reconcileConnectedGuildInstalls([replacementGuild], {
        getConnectedGuild: () => replacementGuild,
        claimReplacement,
        waitBeforeRetry,
      });
      if (failReplacementSave) {
        expect(acceptReplacement).not.toHaveBeenCalled();
        expect(waitBeforeRetry.mock.calls).toEqual([[250], [1000]]);
        expect(currentReplacement).toMatchObject({
          kind: "reconciliation",
          retiredAttribution: {
            tokenIds: [101],
            retiredAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        });
        await reconcileConnectedGuildInstalls([replacementGuild], {
          getConnectedGuild: () => replacementGuild,
          claimReplacement,
        });
      }

      const replacementInstall = await prisma.guildInstall.findUniqueOrThrow({
        where: { serverId: SERVER_ID },
      });
      expect(replacementInstall).toMatchObject({
        analyticsLifecycleTracked: true,
        removedAt: null,
      });
      expect(replacementInstall.analyticsInstallationId).not.toBe(
        historicalInstall.analyticsInstallationId,
      );
      expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
      expect(captureGuildInstalled.mock.calls[0]?.[1]).toBe("reinstall");
      expect(claimReplacement).toHaveBeenCalledWith(replacementGuild);
      expect(acceptReplacement).toHaveBeenCalledTimes(1);
      expect(restoreRetiredInstallAttribution).toHaveBeenCalledWith(
        {
          tokenIds: [101],
          retiredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        expect.any(Object),
      );
      expect(reconcilePendingInstallAttribution).toHaveBeenCalledWith(
        SERVER_ID,
      );
    },
  );

  it("retains an exact handoff when replacement saving fails", async () => {
    const analyticsInstallationId = "replacement-installation";
    vi.spyOn(prisma.guildInstall, "updateMany")
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expectReplacementClaimRetry({
      analyticsInstallationId,
      replacement: { kind: "reconciliation", analyticsInstallationId },
    });
  });

  it("retains an exact handoff when token restoration fails", async () => {
    const analyticsInstallationId = "restoration-installation";
    restoreRetiredInstallAttribution
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expectReplacementClaimRetry({
      analyticsInstallationId,
      replacement: {
        kind: "reconciliation",
        analyticsInstallationId,
        retiredAttribution: {
          tokenIds: [101],
          retiredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    });

    expect(restoreRetiredInstallAttribution).toHaveBeenCalledTimes(4);
  });
});

describe("handleGuildCreate — serialized replacement transitions", () => {
  it("preserves a handoff generation attributed by the browser", async () => {
    const attributedAt = new Date("2026-01-02T00:00:00.000Z");
    const historical = await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        analyticsLifecycleTracked: false,
        attributedAt,
        attributionSurface: "guild_picker",
      },
    });

    const returnedInstallationId = await saveGuildInstall(
      guildFixture(),
      testAccountId("77"),
      true,
      {
        kind: "reconciliation",
        analyticsInstallationId: historical.analyticsInstallationId,
        retiredAttribution: {
          tokenIds: [101],
          retiredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    );

    expect(returnedInstallationId).toBe(historical.analyticsInstallationId);
    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({
      analyticsInstallationId: historical.analyticsInstallationId,
      analyticsLifecycleTracked: true,
      attributedAt,
      attributionSurface: "guild_picker",
    });
    expect(restoreRetiredInstallAttribution).not.toHaveBeenCalled();
    expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
  });

  it("rotates an active generation after an observed removal", async () => {
    const original = await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    await saveGuildInstall(guildFixture(), testAccountId("77"), true, {
      kind: "observed-removal",
      observedAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const replacement = await prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(replacement.analyticsInstallationId).not.toBe(
      original.analyticsInstallationId,
    );
    expect(replacement.analyticsLifecycleTracked).toBe(true);
    expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
  });
});

describe("handleGuildCreate — observed removal attribution", () => {
  it("preserves attribution completed after an observed removal", async () => {
    const observedAt = new Date("2026-02-01T00:00:00.000Z");
    const attributedAt = new Date("2026-02-01T00:01:00.000Z");
    const original = await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        attributedAt,
        attributionSurface: "guild_picker",
      },
    });

    await saveGuildInstall(guildFixture(), testAccountId("77"), true, {
      kind: "observed-removal",
      observedAt,
    });

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({
      analyticsInstallationId: original.analyticsInstallationId,
      attributedAt,
      attributionSurface: "guild_picker",
    });
    expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
    expect(captureGuildInstalled.mock.calls[0]?.[0]).toMatchObject({
      analyticsInstallationId: original.analyticsInstallationId,
    });
  });
});

describe("handleGuildCreate — replacement recovery", () => {
  it("restores handoff attribution after an intervening removal", async () => {
    const historical = await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        analyticsLifecycleTracked: false,
        removedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const retiredAttribution = {
      tokenIds: [101],
      retiredAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    await saveGuildInstall(guildFixture(), testAccountId("77"), true, {
      kind: "reconciliation",
      analyticsInstallationId: historical.analyticsInstallationId,
      retiredAttribution,
    });

    expect(restoreRetiredInstallAttribution).toHaveBeenCalledWith(
      retiredAttribution,
      expect.any(Object),
    );
    expect(reconcilePendingInstallAttribution).toHaveBeenCalledWith(SERVER_ID);
  });

  it("returns the active generation after a lost reinstall claim", async () => {
    const install = await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    await expect(
      saveGuildInstall(guildFixture(), testAccountId("77"), false),
    ).resolves.toBe(install.analyticsInstallationId);
  });

  it("marks a recovered reinstall removed when it leaves during its write", async () => {
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        removedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    await reconcileWhileGuildLeaves();

    await expect(
      prisma.guildInstall.findUniqueOrThrow({ where: { serverId: SERVER_ID } }),
    ).resolves.toMatchObject({ removedAt: expect.any(Date) });
  });

  it("does not touch the install row when the guild is unavailable", async () => {
    const installedAt = new Date("2026-01-01T00:00:00.000Z");
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt,
        removedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    const guild = guildFixture();
    Object.defineProperty(guild, "available", { value: false });
    await handleGuildCreate(guild);

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(row?.installedAt).toEqual(installedAt);
    expect(row?.removedAt).not.toBeNull();
  });

  it("claims exactly one installation identity across concurrent guildCreate callbacks for a new guild", async () => {
    // Regression coverage for a race where two overlapping guildCreate
    // callbacks for a never-before-seen guild both read no existing row and
    // both believed they were making the first install, rotating
    // analyticsInstallationId twice and double-counting the funnel.
    await Promise.all([
      handleGuildCreate(guildFixture()),
      handleGuildCreate(guildFixture()),
    ]);

    const rows = await prisma.guildInstall.findMany({
      where: { serverId: SERVER_ID },
    });
    expect(rows).toHaveLength(1);
    expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
    expect(captureGuildInstalled.mock.calls[0]?.[1]).toBe("first");
  });

  it("claims exactly one reinstall identity across concurrent guildCreate callbacks for a removed guild", async () => {
    await prisma.guildInstall.create({
      data: {
        serverId: SERVER_ID,
        serverName: "Fixture Server",
        ownerDiscordId: testAccountId("77"),
        addedByDiscordId: testAccountId("77"),
        memberCount: 10,
        installedAt: new Date("2026-01-01T00:00:00.000Z"),
        removedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    const originalRow = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    const originalAnalyticsInstallationId =
      originalRow?.analyticsInstallationId;

    await Promise.all([
      handleGuildCreate(guildFixture()),
      handleGuildCreate(guildFixture()),
    ]);

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(row?.removedAt).toBeNull();
    expect(row?.analyticsInstallationId).not.toBe(
      originalAnalyticsInstallationId,
    );
    expect(captureGuildInstalled).toHaveBeenCalledTimes(1);
    expect(captureGuildInstalled.mock.calls[0]?.[1]).toBe("reinstall");
    // The two identities answer different questions and must not move together:
    // analyticsInstallationId rotates (asserted above) so install-level funnels
    // restart, while serverId stays put so guild-level history survives.
    expect(captureGuildInstalled.mock.calls[0]?.[0]).toMatchObject({
      analyticsInstallationId: row?.analyticsInstallationId,
      serverId: SERVER_ID,
    });
  });
});
