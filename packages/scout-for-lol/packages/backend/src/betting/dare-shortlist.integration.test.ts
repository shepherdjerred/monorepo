import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import {
  buildDareShortlist,
  DARE_SHORTLIST_CAP,
} from "#src/betting/dare-shortlist.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("dare-shortlist");
const SERVER_ID = testGuildId("801");
const OTHER_SERVER_ID = testGuildId("802");
const CREATOR_ID = testAccountId("801");
const CHALLENGER_ID = testAccountId("899");
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

describe("buildDareShortlist", () => {
  test("offers only darable people: tracked, linked, not the challenger", async () => {
    const targetDiscordId = testAccountId("811");
    const targetPuuid = testPuuid("dare-target");
    const targetPlayerId = await createPlayer({
      alias: "target",
      serverId: SERVER_ID,
      discordId: targetDiscordId,
      accounts: [targetPuuid],
    });
    await createPlayer({
      alias: "challenger",
      serverId: SERVER_ID,
      discordId: CHALLENGER_ID,
      accounts: [testPuuid("dare-challenger")],
    });
    await createPlayer({
      alias: "no-discord",
      serverId: SERVER_ID,
      accounts: [testPuuid("dare-no-discord")],
    });
    await createPlayer({
      alias: "no-account",
      serverId: SERVER_ID,
      discordId: testAccountId("812"),
      accounts: [],
    });
    await createPlayer({
      alias: "other-server",
      serverId: OTHER_SERVER_ID,
      discordId: testAccountId("813"),
      accounts: [testPuuid("dare-other-server")],
    });

    await expect(
      buildDareShortlist(SERVER_ID, CHALLENGER_ID, prisma),
    ).resolves.toEqual([
      {
        key: "T1",
        discordId: targetDiscordId,
        playerId: targetPlayerId,
        alias: "target",
        accounts: [
          {
            puuid: targetPuuid,
            trackingStartedAt: CREATED_AT.toISOString(),
          },
        ],
      },
    ]);
  });

  test("unions accounts across one user's Player rows; lowest playerId names them", async () => {
    const sharedDiscordId = testAccountId("821");
    const firstPuuid = testPuuid("dare-union-first");
    const secondPuuid = testPuuid("dare-union-second");
    const firstPlayerId = await createPlayer({
      alias: "original-alias",
      serverId: SERVER_ID,
      discordId: sharedDiscordId,
      accounts: [firstPuuid, secondPuuid],
    });
    // A second Player row for the same person (the DB's unique
    // (serverId, puuid) means its accounts are necessarily distinct).
    await createPlayer({
      alias: "smurf-alias",
      serverId: SERVER_ID,
      discordId: sharedDiscordId,
      accounts: [testPuuid("dare-union-third")],
    });

    const shortlist = await buildDareShortlist(
      SERVER_ID,
      CHALLENGER_ID,
      prisma,
    );
    expect(shortlist).toHaveLength(1);
    expect(shortlist[0]).toEqual({
      key: "T1",
      discordId: sharedDiscordId,
      playerId: firstPlayerId,
      alias: "original-alias",
      accounts: [
        { puuid: firstPuuid, trackingStartedAt: CREATED_AT.toISOString() },
        {
          puuid: secondPuuid,
          trackingStartedAt: new Date(
            CREATED_AT.getTime() + 60_000,
          ).toISOString(),
        },
        {
          puuid: testPuuid("dare-union-third"),
          trackingStartedAt: CREATED_AT.toISOString(),
        },
      ],
    });
  });

  test("assigns T1..Tn in alias-ascending order", async () => {
    await createPlayer({
      alias: "zed-main",
      serverId: SERVER_ID,
      discordId: testAccountId("831"),
      accounts: [testPuuid("dare-order-z")],
    });
    await createPlayer({
      alias: "ashe-main",
      serverId: SERVER_ID,
      discordId: testAccountId("832"),
      accounts: [testPuuid("dare-order-a")],
    });
    await createPlayer({
      alias: "mid-main",
      serverId: SERVER_ID,
      discordId: testAccountId("833"),
      accounts: [testPuuid("dare-order-m")],
    });

    const shortlist = await buildDareShortlist(
      SERVER_ID,
      CHALLENGER_ID,
      prisma,
    );
    expect(
      shortlist.map((entry) => ({ key: entry.key, alias: entry.alias })),
    ).toEqual([
      { key: "T1", alias: "ashe-main" },
      { key: "T2", alias: "mid-main" },
      { key: "T3", alias: "zed-main" },
    ]);
  });

  test("caps the shortlist at 30 entries", async () => {
    for (let index = 0; index < DARE_SHORTLIST_CAP + 2; index += 1) {
      const suffix = index.toString().padStart(2, "0");
      await createPlayer({
        alias: `cap-${suffix}`,
        serverId: SERVER_ID,
        discordId: testAccountId(`84${suffix}`),
        accounts: [testPuuid(`dare-cap-${suffix}`)],
      });
    }

    const shortlist = await buildDareShortlist(
      SERVER_ID,
      CHALLENGER_ID,
      prisma,
    );
    expect(shortlist).toHaveLength(DARE_SHORTLIST_CAP);
    expect(shortlist[0]?.alias).toBe("cap-00");
    expect(shortlist.at(-1)?.alias).toBe(
      `cap-${(DARE_SHORTLIST_CAP - 1).toString()}`,
    );
    expect(shortlist.map((entry) => entry.key)).toEqual(
      shortlist.map((_, index) => `T${(index + 1).toString()}`),
    );
  });
});
