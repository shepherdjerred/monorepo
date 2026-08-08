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

const { prisma } = createTestDatabase("guild-create-install-test");

const databaseModule = await import("#src/database/index.ts");
void mock.module("#src/database/index.ts", () => ({
  ...databaseModule,
  prisma,
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

describe("handleGuildCreate — GuildInstall bookkeeping", () => {
  beforeEach(async () => {
    await prisma.guildInstall.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records a first install with a fresh outreach slate", async () => {
    await handleGuildCreate(guildFixture());

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    expect(row).not.toBeNull();
    expect(row?.outreach3dSentAt).toBeNull();
    expect(row?.removedAt).toBeNull();
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
      },
    });

    await handleGuildCreate(guildFixture());

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    // The whole point: no reset, so the outreach ladder cannot replay.
    expect(row?.outreach3dSentAt).toEqual(sentAt);
    expect(row?.outreach14dSentAt).toEqual(sentAt);
    expect(row?.outreach30dSentAt).toEqual(sentAt);
    expect(row?.installedAt).toEqual(originalInstall);
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
      },
    });

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
    expect(row?.installedAt.getTime()).toBeGreaterThan(
      new Date("2026-01-01T00:00:00.000Z").getTime(),
    );
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
});
