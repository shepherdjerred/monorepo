import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  createServerSetupExecutor,
  setupFindings,
} from "#src/explore/tools/server-setup-tools.ts";
import type { PostableChannel } from "#src/lib/discord/postable-channels.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testPuuid } from "#src/testing/test-ids.ts";
import { SCENARIO_REPORT_QUERY } from "#src/explore/scenarios/fixtures.ts";

const { prisma } = createTestDatabase("explore-server-setup-test");
const ASKER = testAccountId("91");
const SERVER = DiscordGuildIdSchema.parse("100000000000000091");
const OTHER = DiscordGuildIdSchema.parse("100000000000000092");
const GENERAL = DiscordChannelIdSchema.parse("200000000000000091");
const GONE = DiscordChannelIdSchema.parse("200000000000000092");
const STAMPS = {
  serverId: SERVER,
  creatorDiscordId: ASKER,
  createdTime: new Date("2026-10-01T00:00:00.000Z"),
  updatedTime: new Date("2026-10-01T00:00:00.000Z"),
};

const CHANNELS: PostableChannel[] = [
  { id: GENERAL, name: "general", parentId: null },
];

async function readSetup(server: typeof SERVER | null, guildIds = [SERVER]) {
  const execute = createServerSetupExecutor(
    { db: prisma, guildIds, requesterId: ASKER },
    { listChannels: () => Promise.resolve(CHANNELS) },
  );
  return await execute({ server });
}

async function trackPlayer(alias: string, feedChannel: typeof GENERAL | null) {
  const player = await prisma.player.create({
    data: {
      alias,
      ...STAMPS,
      accounts: {
        create: {
          alias,
          puuid: testPuuid(alias),
          region: "AMERICA_NORTH",
          riotGameName: alias,
          riotTagLine: "NA1",
          ...STAMPS,
        },
      },
    },
  });
  if (feedChannel !== null) {
    await prisma.subscription.create({
      data: { playerId: player.id, channelId: feedChannel, ...STAMPS },
    });
  }
}

beforeEach(async () => {
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.report.deleteMany();
  await prisma.guildInstall.deleteMany();
  await prisma.guildInstall.create({
    data: {
      serverId: SERVER,
      serverName: "Bwa Town",
      ownerDiscordId: ASKER,
      addedByDiscordId: ASKER,
      memberCount: 4,
      installedAt: STAMPS.createdTime,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("setupFindings", () => {
  test("no tracked players is the whole answer", () => {
    expect(
      setupFindings({
        trackedPlayers: 0,
        feeds: 0,
        unreachableFeeds: 0,
        lastMatchPost: null,
      }),
    ).toEqual([expect.stringContaining("tracks no players")]);
  });

  test("players without feeds, and feeds Scout cannot post in, are each named", () => {
    const findings = setupFindings({
      trackedPlayers: 2,
      feeds: 0,
      unreachableFeeds: 0,
      lastMatchPost: null,
    });
    expect(findings.join(" ")).toContain("none has a feed");
    expect(
      setupFindings({
        trackedPlayers: 2,
        feeds: 2,
        unreachableFeeds: 1,
        lastMatchPost: new Date(),
      }).join(" "),
    ).toContain("can no longer post in");
  });
});

describe("get_server_setup", () => {
  test("an empty server leads with why nothing posts", async () => {
    const result = await readSetup(null);
    expect(result.kind).toBe("server_setup");
    expect(result.message).toContain("tracks no players");
  });

  test("lists players, feeds and reports, naming a channel Scout lost", async () => {
    await trackPlayer("Omz", GENERAL);
    await trackPlayer("Moon", GONE);
    await prisma.report.create({
      data: {
        serverId: SERVER,
        ownerId: ASKER,
        channelId: GENERAL,
        title: "Weekly Win Rates",
        queryText: SCENARIO_REPORT_QUERY,
        cronExpression: "0 12 * * 1",
        isEnabled: true,
        createdTime: STAMPS.createdTime,
        updatedTime: STAMPS.updatedTime,
      },
    });

    const result = await readSetup(SERVER);
    const json = JSON.stringify(result.data);
    expect(json).toContain('"server":"Bwa Town"');
    expect(json).toContain('"feeds":["#general"]');
    expect(json).toContain("a channel Scout can no longer post in");
    expect(json).toContain('"title":"Weekly Win Rates"');
    expect(json).toContain("/app/g/100000000000000091/reports");
    expect(result.message).toContain("can no longer post in");
  });

  test("several servers in scope with none named asks which", async () => {
    const result = await readSetup(null, [SERVER, OTHER]);
    expect(result.kind).toBe("choose_server");
  });

  test("a server outside the turn's scope is refused", async () => {
    const result = await readSetup(OTHER);
    expect(result.kind).toBe("unavailable");
  });
});
