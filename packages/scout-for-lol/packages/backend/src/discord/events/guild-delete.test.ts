/**
 * Tests for the Guild Delete event handler.
 *
 * Two things matter here beyond cleanup: removals must be *counted* (churn was
 * previously invisible — a `guilds_left_total` series lingered in Prometheus
 * that nothing in the codebase incremented), and the removal must be *stamped*
 * so a later `guildCreate` can be recognised as a genuine re-install.
 */

import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { mockGuild } from "#src/testing/discord-mocks.ts";
import { testGuildId, testAccountId } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("guild-delete-test");

const databaseModule = await import("#src/database/index.ts");
void mock.module("#src/database/index.ts", () => ({
  ...databaseModule,
  prisma,
}));

const sendDMMock = mock(() => Promise.resolve("sent"));
void mock.module("#src/discord/utils/dm.ts", () => ({
  sendDM: sendDMMock,
}));

const { handleGuildDelete } =
  await import("#src/discord/events/guild-delete.ts");
const { guildsLeftTotal } = await import("#src/metrics/web.ts");

const SERVER_ID = testGuildId("600");

async function guildsLeftValue(): Promise<number> {
  const metric = await guildsLeftTotal.get();
  return metric.values[0]?.value ?? 0;
}

function guildFixture(overrides: Record<string, unknown> = {}) {
  return mockGuild({
    id: SERVER_ID,
    name: "Departing Server",
    ownerId: testAccountId("88"),
    ...overrides,
  });
}

async function seedInstall(): Promise<void> {
  await prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: "Departing Server",
      ownerDiscordId: testAccountId("88"),
      addedByDiscordId: testAccountId("88"),
      memberCount: 10,
      installedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}

describe("handleGuildDelete", () => {
  beforeEach(async () => {
    sendDMMock.mockClear();
    await prisma.guildInstall.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stamps removedAt so a later install is recognised as a re-install", async () => {
    await seedInstall();

    await handleGuildDelete(guildFixture());

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    // cleanupRemovedGuild deliberately keeps this row, so removedAt is the only
    // way to tell a real re-install from a replayed guildCreate.
    expect(row?.removedAt).not.toBeNull();
  });

  it("counts the removal", async () => {
    await seedInstall();
    const before = await guildsLeftValue();

    await handleGuildDelete(guildFixture());

    expect(await guildsLeftValue()).toBe(before + 1);
  });

  it("does nothing when the guild is merely unavailable", async () => {
    await seedInstall();
    const before = await guildsLeftValue();

    await handleGuildDelete(guildFixture({ available: false }));

    const row = await prisma.guildInstall.findUnique({
      where: { serverId: SERVER_ID },
    });
    // A Discord outage is not a removal: no stamp, no count, no data deleted.
    expect(row?.removedAt).toBeNull();
    expect(await guildsLeftValue()).toBe(before);
    expect(sendDMMock).not.toHaveBeenCalled();
  });
});
