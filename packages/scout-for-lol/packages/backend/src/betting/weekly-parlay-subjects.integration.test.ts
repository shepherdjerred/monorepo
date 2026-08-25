import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import { loadWeeklyParlaySubjects } from "#src/betting/weekly-parlay-subjects.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("weekly-parlay-subjects");
const SERVER_ID = testGuildId("701");
const OTHER_SERVER_ID = testGuildId("702");
const CREATOR_ID = testAccountId("701");
const CREATED_AT = new Date("2026-08-24T12:00:00.000Z");

async function createPlayer(input: {
  alias: string;
  serverId: DiscordGuildId;
  discordId?: DiscordAccountId;
  accounts: readonly LeaguePuuid[];
}): Promise<number> {
  const player = await prisma.player.create({
    data: {
      alias: input.alias,
      ...(input.discordId === undefined ? {} : { discordId: input.discordId }),
      serverId: input.serverId,
      creatorDiscordId: CREATOR_ID,
      createdTime: CREATED_AT,
      updatedTime: CREATED_AT,
    },
  });
  for (const [index, puuid] of input.accounts.entries()) {
    await prisma.account.create({
      data: {
        alias: `${input.alias}-${index.toString()}`,
        puuid,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: input.serverId,
        creatorDiscordId: CREATOR_ID,
        createdTime: new Date(CREATED_AT.getTime() + index * 60_000),
        updatedTime: CREATED_AT,
      },
    });
  }
  return player.id;
}

beforeEach(async () => {
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
});

afterAll(async () => {
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.$disconnect();
});

describe("loadWeeklyParlaySubjects", () => {
  test("loads deterministic eligible subjects solely from database links", async () => {
    const firstDiscordId = testAccountId("711");
    const secondDiscordId = testAccountId("712");
    const firstPuuid = testPuuid("weekly-first");
    const secondPuuid = testPuuid("weekly-second");
    const thirdPuuid = testPuuid("weekly-third");
    const firstPlayerId = await createPlayer({
      alias: "first",
      serverId: SERVER_ID,
      discordId: firstDiscordId,
      accounts: [firstPuuid, secondPuuid],
    });
    await createPlayer({
      alias: "missing-discord",
      serverId: SERVER_ID,
      accounts: [testPuuid("missing-discord")],
    });
    await createPlayer({
      alias: "missing-account",
      serverId: SERVER_ID,
      discordId: testAccountId("713"),
      accounts: [],
    });
    await createPlayer({
      alias: "other-server",
      serverId: OTHER_SERVER_ID,
      discordId: testAccountId("714"),
      accounts: [testPuuid("other-server")],
    });
    const secondPlayerId = await createPlayer({
      alias: "second",
      serverId: SERVER_ID,
      discordId: secondDiscordId,
      accounts: [thirdPuuid],
    });

    await expect(loadWeeklyParlaySubjects(SERVER_ID, prisma)).resolves.toEqual([
      {
        key: "P1",
        playerId: firstPlayerId,
        alias: "first",
        discordId: firstDiscordId,
        accounts: [
          {
            puuid: firstPuuid,
            trackingStartedAt: CREATED_AT.toISOString(),
          },
          {
            puuid: secondPuuid,
            trackingStartedAt: new Date(
              CREATED_AT.getTime() + 60_000,
            ).toISOString(),
          },
        ],
      },
      {
        key: "P1",
        playerId: secondPlayerId,
        alias: "second",
        discordId: secondDiscordId,
        accounts: [
          {
            puuid: thirdPuuid,
            trackingStartedAt: CREATED_AT.toISOString(),
          },
        ],
      },
    ]);
  });
});
