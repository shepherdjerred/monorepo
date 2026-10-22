import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  exploreAskerSection,
  loadExploreAsker,
} from "#src/explore/identity/asker.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testPuuid } from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("explore-asker-test");
const ASKER = testAccountId("71");
const SERVER = DiscordGuildIdSchema.parse("100000000000000071");
const OTHER_SERVER = DiscordGuildIdSchema.parse("100000000000000072");
const STAMPS = {
  creatorDiscordId: ASKER,
  createdTime: new Date("2026-10-01T00:00:00.000Z"),
  updatedTime: new Date("2026-10-01T00:00:00.000Z"),
};

async function trackPlayer(input: {
  serverId: typeof SERVER;
  alias: string;
  discordId: typeof ASKER | null;
  riot: { gameName: string; tagLine: string } | null;
}): Promise<void> {
  await prisma.player.create({
    data: {
      alias: input.alias,
      discordId: input.discordId,
      serverId: input.serverId,
      ...STAMPS,
      accounts: {
        create: {
          alias: input.alias,
          puuid: testPuuid(input.alias),
          region: "AMERICA_NORTH",
          riotGameName: input.riot?.gameName ?? null,
          riotTagLine: input.riot?.tagLine ?? null,
          serverId: input.serverId,
          ...STAMPS,
        },
      },
    },
  });
}

beforeEach(async () => {
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.guildInstall.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: { discordId: ASKER, discordUsername: "rosie" },
  });
  await prisma.guildInstall.create({
    data: {
      serverId: SERVER,
      serverName: "Bwa Town",
      ownerDiscordId: ASKER,
      addedByDiscordId: ASKER,
      memberCount: 5,
      installedAt: STAMPS.createdTime,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("loadExploreAsker", () => {
  test("finds the asker's tracked player in the servers in scope", async () => {
    await trackPlayer({
      serverId: SERVER,
      alias: "Omz",
      discordId: ASKER,
      riot: { gameName: "RoziSucks", tagLine: "0000" },
    });
    await trackPlayer({
      serverId: SERVER,
      alias: "Moon",
      discordId: null,
      riot: { gameName: "LadyLunacy", tagLine: "777" },
    });
    await trackPlayer({
      serverId: OTHER_SERVER,
      alias: "Elsewhere",
      discordId: ASKER,
      riot: null,
    });

    const asker = await loadExploreAsker(
      { requesterId: ASKER, guildIds: [SERVER] },
      prisma,
    );

    expect(asker).toEqual({
      username: "rosie",
      players: [
        { serverName: "Bwa Town", alias: "Omz", riotIds: ["RoziSucks#0000"] },
      ],
    });
  });

  test("an unlinked asker has no players", async () => {
    const asker = await loadExploreAsker(
      { requesterId: ASKER, guildIds: [SERVER] },
      prisma,
    );
    expect(asker.players).toEqual([]);
  });
});

describe("exploreAskerSection", () => {
  test("tells the model who 'me' is and never to ask", () => {
    const section = exploreAskerSection({
      username: "rosie",
      players: [
        { serverName: "Bwa Town", alias: "Omz", riotIds: ["RoziSucks#0000"] },
      ],
    });
    expect(section).toContain("The person asking is @rosie on Discord.");
    expect(section).toContain(
      "In Bwa Town they are the tracked player Omz (Riot ID RoziSucks#0000).",
    );
    expect(section).toContain("never ask who they are");
  });

  test("an unlinked asker is told so, with a way to get linked", () => {
    const section = exploreAskerSection({ username: "rosie", players: [] });
    expect(section).toContain("not linked to a tracked player");
    expect(section).toContain(
      "player feed linked to their own Discord account",
    );
  });
});
