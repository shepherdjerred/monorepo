import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  getFullLeaderboard,
  getLedgerPage,
  getOpenMarketAggregates,
  getPersonalBucksView,
} from "#src/betting/accounts.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-accounts");
const SERVER_A = DiscordGuildIdSchema.parse("1337623164146155593");
const SERVER_B = DiscordGuildIdSchema.parse("2337623164146155593");
const USER_A = bucksTestDiscordId(1);
const USER_B = bucksTestDiscordId(2);

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

async function createLedger(accountId: number, count: number): Promise<void> {
  for (let index = 1; index <= count; index++) {
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: accountId,
        delta: 1,
        balanceAfter: index,
        kind: "adjustment",
        context: JSON.stringify({ type: "adjustment", note: "test" }),
      },
    });
  }
}

describe("getLedgerPage", () => {
  test("returns stable first, middle, and last pages", async () => {
    const account = await db.bucksAccount.create({
      data: { serverId: SERVER_A, discordId: USER_A, balance: 25 },
    });
    await createLedger(account.id, 25);

    const first = await getLedgerPage(
      { serverId: SERVER_A, discordId: USER_A, page: 0 },
      db,
    );
    expect(first.entries.map((entry) => entry.balanceAfter)).toEqual([
      25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
    ]);
    expect(first.totalPages).toBe(3);
    expect(first.snapshotId).not.toBeNull();

    await createLedger(account.id, 1);
    const snapshotId = first.snapshotId;
    if (snapshotId === null) {
      throw new Error("The populated ledger did not produce a snapshot ID");
    }
    const middle = await getLedgerPage(
      {
        serverId: SERVER_A,
        discordId: USER_A,
        page: 1,
        snapshotId,
      },
      db,
    );
    const last = await getLedgerPage(
      {
        serverId: SERVER_A,
        discordId: USER_A,
        page: 2,
        snapshotId,
      },
      db,
    );

    expect(middle.entries.map((entry) => entry.balanceAfter)).toEqual([
      15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
    ]);
    expect(last.entries.map((entry) => entry.balanceAfter)).toEqual([
      5, 4, 3, 2, 1,
    ]);
    expect(middle.totalEntries).toBe(25);
    expect(last.totalPages).toBe(3);
  });

  test("scopes a snapshot to the caller and guild", async () => {
    const accountA = await db.bucksAccount.create({
      data: { serverId: SERVER_A, discordId: USER_A, balance: 1 },
    });
    const accountB = await db.bucksAccount.create({
      data: { serverId: SERVER_B, discordId: USER_A, balance: 2 },
    });
    const otherUser = await db.bucksAccount.create({
      data: { serverId: SERVER_A, discordId: USER_B, balance: 3 },
    });
    await createLedger(accountA.id, 1);
    await createLedger(accountB.id, 2);
    await createLedger(otherUser.id, 3);

    const page = await getLedgerPage(
      { serverId: SERVER_A, discordId: USER_A, page: 0 },
      db,
    );
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.balanceAfter).toBe(1);
  });
});

describe("personal positions and open markets", () => {
  test("returns only the caller's positions while markets expose aggregates", async () => {
    const caller = await db.bucksAccount.create({
      data: { serverId: SERVER_A, discordId: USER_A, balance: 80 },
    });
    const other = await db.bucksAccount.create({
      data: { serverId: SERVER_A, discordId: USER_B, balance: 90 },
    });
    const house = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
        isHouse: true,
        balance: 10_000,
      },
    });
    const pool = await db.bucksMatchPool.create({
      data: {
        matchId: "NA1_5000000100",
        serverId: SERVER_A,
        detectedAt: new Date("2030-01-01T00:00:00Z"),
        closesAt: new Date("2030-01-01T00:10:00Z"),
        roster: JSON.stringify({ participants: bucksTestRoster() }),
      },
    });
    await db.bucksBet.createMany({
      data: [
        {
          poolId: pool.id,
          bucksAccountId: caller.id,
          predictedTeamId: 100,
          subjectPuuid: bucksTestPuuid(0),
          stake: 20,
        },
        {
          poolId: pool.id,
          bucksAccountId: other.id,
          predictedTeamId: 100,
          subjectPuuid: bucksTestPuuid(5),
          stake: 30,
        },
        {
          poolId: pool.id,
          bucksAccountId: house.id,
          predictedTeamId: 200,
          subjectPuuid: bucksTestPuuid(0),
          stake: 50,
        },
      ],
    });

    const personal = await getPersonalBucksView(
      { serverId: SERVER_A, discordId: USER_A },
      db,
    );
    expect(personal).toEqual(
      expect.objectContaining({
        balance: 80,
        totalStaked: 20,
        pendingPositionCount: 1,
      }),
    );
    expect(personal?.pendingPositions).toEqual([
      expect.objectContaining({
        subjectAlias: "jerred",
        side: "WIN",
        stake: 20,
      }),
    ]);

    const markets = await getOpenMarketAggregates(
      { serverId: SERVER_A, now: new Date("2030-01-01T00:05:00Z") },
      db,
    );
    expect(markets).toEqual([
      expect.objectContaining({
        blue: {
          trackedPlayers: ["jerred"],
          totalStake: 50,
          betCount: 2,
        },
        red: {
          trackedPlayers: ["bryan"],
          totalStake: 0,
          betCount: 0,
        },
      }),
    ]);
    const rendered = JSON.stringify(markets);
    expect(rendered).not.toContain(USER_A);
    expect(rendered).not.toContain(USER_B);
    expect(rendered).not.toContain(HOUSE_ACCOUNT_DISCORD_ID);
  });

  test("caps the detailed personal position list at ten without understating total stake", async () => {
    const caller = await db.bucksAccount.create({
      data: { serverId: SERVER_A, discordId: USER_A, balance: 100 },
    });
    for (let index = 0; index < 11; index++) {
      const pool = await db.bucksMatchPool.create({
        data: {
          matchId: `NA1_50000002${index.toString().padStart(2, "0")}`,
          serverId: SERVER_A,
          detectedAt: new Date("2030-01-01T00:00:00Z"),
          closesAt: new Date("2030-01-01T00:10:00Z"),
          roster: JSON.stringify({ participants: bucksTestRoster() }),
        },
      });
      await db.bucksBet.create({
        data: {
          poolId: pool.id,
          bucksAccountId: caller.id,
          predictedTeamId: 100,
          subjectPuuid: bucksTestPuuid(0),
          stake: index + 1,
        },
      });
    }

    const personal = await getPersonalBucksView(
      { serverId: SERVER_A, discordId: USER_A },
      db,
    );
    expect(personal?.pendingPositionCount).toBe(11);
    expect(personal?.pendingPositions).toHaveLength(10);
    expect(personal?.totalStaked).toBe(66);
  });
});

describe("getFullLeaderboard", () => {
  test("includes zero balances, orders ties by account ID, and excludes house/other guilds", async () => {
    const tiedFirst = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: bucksTestDiscordId(4),
        balance: 9,
      },
    });
    const tiedSecond = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: bucksTestDiscordId(3),
        balance: 9,
      },
    });
    const zero = await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: bucksTestDiscordId(5),
        balance: 0,
      },
    });
    await db.bucksAccount.create({
      data: {
        serverId: SERVER_A,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
        isHouse: true,
        balance: 10_000,
      },
    });
    await db.bucksAccount.create({
      data: {
        serverId: SERVER_B,
        discordId: bucksTestDiscordId(6),
        balance: 99,
      },
    });

    expect(await getFullLeaderboard({ serverId: SERVER_A }, db)).toEqual([
      {
        accountId: tiedFirst.id,
        discordId: tiedFirst.discordId,
        balance: 9,
      },
      {
        accountId: tiedSecond.id,
        discordId: tiedSecond.discordId,
        balance: 9,
      },
      { accountId: zero.id, discordId: zero.discordId, balance: 0 },
    ]);
  });
});
