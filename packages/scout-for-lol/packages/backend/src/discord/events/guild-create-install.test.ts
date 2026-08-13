/**
 * GuildInstall bookkeeping in handleGuildCreate.
 *
 * The behaviour under test is the anti-spam invariant: a `guildCreate` for a
 * guild we never left must NOT restart onboarding, because doing so re-arms the
 * onboarding DMs and falsifies `installedAt` for a long-standing server. Only a
 * removal we actually observed (`removedAt`) makes it a genuine re-install.
 */

import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { ChannelType } from "discord.js";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { mockGuild, mockTextChannel } from "#src/testing/discord-mocks.ts";
import { testGuildId, testAccountId } from "#src/testing/test-ids.ts";
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";

const { prisma } = createTestDatabase("guild-create-install-test");

const databaseModule = await import("#src/database/index.ts");
void mock.module("#src/database/index.ts", () => ({
  ...databaseModule,
  prisma,
}));

// Stubbed so concurrent-install tests can assert call counts without
// touching the real product analytics singleton (network/PostHog init).
const guildLifecycleModule = await import("#src/analytics/guild-lifecycle.ts");
const captureGuildInstalled =
  mock<typeof guildLifecycleModule.captureGuildInstalled>();
void mock.module("#src/analytics/guild-lifecycle.ts", () => ({
  ...guildLifecycleModule,
  captureGuildInstalled,
}));

const { handleGuildCreate } =
  await import("#src/discord/events/guild-create.ts");

const SERVER_ID = testGuildId("500");

function guildFixture(): ReturnType<typeof mockGuild> {
  return mockGuild({
    name: "Fixture Server",
    id: SERVER_ID,
    memberCount: 42,
    ownerId: testAccountId("77"),
    systemChannel: mockTextChannel({
      type: ChannelType.GuildText,
      name: "general",
      permissionsFor: mock(() => ({ has: mock(() => true) })),
      send: mock(() => Promise.resolve({})),
    }),
    channels: { fetch: mock(() => Promise.resolve(new Map())) },
    members: { me: { id: testAccountId("999") } },
    client: { user: { id: testAccountId("999") } },
  });
}

beforeEach(async () => {
  await prisma.guildInstall.deleteMany();
  captureGuildInstalled.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("handleGuildCreate — GuildInstall bookkeeping", () => {
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

describe("handleGuildCreate — availability guard and concurrent races", () => {
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
