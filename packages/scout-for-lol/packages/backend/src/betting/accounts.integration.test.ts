import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BucksLedgerContextSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  ensureBucksAccount,
  HouseInsufficientError,
  getFullLeaderboard,
  getLedgerPage,
  getOpenMarketAggregates,
  getPersonalBucksView,
} from "#src/betting/accounts.ts";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
  SEED_GRANT,
} from "#src/betting/constants.ts";
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
  await db.bucksParlayBet.deleteMany();
  await db.bucksParlayMarket.deleteMany();
  await db.bucksParlayDefinition.deleteMany();
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

async function createPendingParlayPosition(input: {
  poolId: number;
  matchId: string;
  accountId: number;
}): Promise<void> {
  const definition = await db.bucksParlayDefinition.create({
    data: {
      matchId: input.matchId,
      queueType: "solo",
      selectedTeamId: 100,
      subjects: JSON.stringify([
        { key: "P1", puuid: bucksTestPuuid(0), alias: "jerred" },
      ]),
      criteria: JSON.stringify({
        version: 1,
        yesProbabilityBps: 5000,
        conditions: [
          {
            kind: "participant_numeric",
            subject: "P1",
            field: "kills",
            operator: "gte",
            threshold: 5,
          },
          {
            kind: "team_objective_first",
            team: "selected",
            objective: "baron",
            expected: true,
          },
        ],
      }),
      yesProbabilityBps: 5000,
      promptVersion: "test",
      catalogVersion: "test",
      schemaVersion: 1,
      evaluatorVersion: "1",
      generationContext: "{}",
      requestedModel: "test",
      usage: "{}",
      durationMs: 1,
    },
  });
  const market = await db.bucksParlayMarket.create({
    data: {
      definitionId: definition.id,
      outcomePoolId: input.poolId,
      matchId: input.matchId,
      serverId: SERVER_A,
      publishedAt: new Date("2030-01-01T00:00:00Z"),
      closesAt: new Date("2030-01-01T00:05:00Z"),
      marketState: "open",
    },
  });
  await db.bucksParlayBet.create({
    data: {
      marketId: market.id,
      bucksAccountId: input.accountId,
      side: "YES",
      stake: 15,
      houseReserve: 15,
      grossPayout: 30,
    },
  });
}

describe("ensureBucksAccount", () => {
  test("transfers the welcome grant from the house instead of minting it", async () => {
    const account = await ensureBucksAccount(
      { serverId: SERVER_A, discordId: USER_A },
      db,
    );
    expect(account.balance).toBe(SEED_GRANT);

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_A,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.isHouse).toBe(true);
    expect(house.balance).toBe(HOUSE_BANKROLL - SEED_GRANT);

    const seeds = await db.bucksLedgerEntry.findMany({
      where: { kind: "seed" },
      orderBy: { id: "asc" },
      select: {
        bucksAccountId: true,
        delta: true,
        balanceAfter: true,
        context: true,
      },
    });
    expect(
      seeds.map(({ bucksAccountId, delta, balanceAfter }) => ({
        bucksAccountId,
        delta,
        balanceAfter,
      })),
    ).toEqual([
      {
        bucksAccountId: house.id,
        delta: HOUSE_BANKROLL,
        balanceAfter: HOUSE_BANKROLL,
      },
      {
        bucksAccountId: house.id,
        delta: -SEED_GRANT,
        balanceAfter: HOUSE_BANKROLL - SEED_GRANT,
      },
      {
        bucksAccountId: account.id,
        delta: SEED_GRANT,
        balanceAfter: SEED_GRANT,
      },
    ]);
    const contexts = seeds.map(({ context }) =>
      BucksLedgerContextSchema.parse(JSON.parse(context)),
    );
    const debit = contexts[1];
    const credit = contexts[2];
    if (debit?.type !== "seed" || credit?.type !== "seed") {
      throw new Error("expected paired seed contexts");
    }
    expect(debit.transferId).toBeDefined();
    expect(debit.transferId).toBe(credit.transferId);
    expect(debit.counterpartyAccountId).toBe(account.id);
    expect(credit.counterpartyAccountId).toBe(house.id);
  });

  test("refuses a welcome grant when the house is exhausted", async () => {
    const first = await ensureBucksAccount(
      { serverId: SERVER_A, discordId: USER_A },
      db,
    );
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_A,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    await db.bucksAccount.update({
      where: { id: house.id },
      data: { balance: 0 },
    });

    await expect(
      ensureBucksAccount({ serverId: SERVER_A, discordId: USER_B }, db),
    ).rejects.toBeInstanceOf(HouseInsufficientError);
    expect(
      await db.bucksAccount.findUnique({
        where: {
          serverId_discordId: {
            serverId: SERVER_A,
            discordId: USER_B,
          },
        },
      }),
    ).toBeNull();
    expect(first.balance).toBe(SEED_GRANT);
  });
});

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
        roster: JSON.stringify({
          participants: bucksTestRoster().map((participant, index) =>
            index === 1
              ? { ...participant, puuid: null, trackedAlias: "scrubbed" }
              : participant,
          ),
        }),
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
    await createPendingParlayPosition({
      poolId: pool.id,
      matchId: pool.matchId,
      accountId: caller.id,
    });

    const personal = await getPersonalBucksView(
      { serverId: SERVER_A, discordId: USER_A },
      db,
    );
    expect(personal).toEqual(
      expect.objectContaining({
        balance: 80,
        totalAtRisk: 35,
        pendingPositionCount: 2,
      }),
    );
    expect(personal?.pendingPositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          marketType: "outcome",
          gameAlias: "jerred",
          teamId: 100,
          offeredStake: 20,
          matchedStake: null,
          unmatchedStake: null,
        }),
        expect.objectContaining({
          marketType: "parlay",
          subjectAlias: "Parlay (jerred)",
          side: "YES",
          stake: 15,
        }),
      ]),
    );

    const redAnchorPersonal = await getPersonalBucksView(
      { serverId: SERVER_A, discordId: USER_B },
      db,
    );
    expect(redAnchorPersonal?.pendingPositions).toEqual([
      expect.objectContaining({
        marketType: "outcome",
        gameAlias: "bryan",
        teamId: 100,
        offeredStake: 30,
        matchedStake: null,
        unmatchedStake: null,
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
    expect(rendered).not.toContain("scrubbed");
    expect(rendered).not.toContain(USER_A);
    expect(rendered).not.toContain(USER_B);
    expect(rendered).not.toContain(HOUSE_ACCOUNT_DISCORD_ID);
  });

  test("caps the detailed personal position list at ten without understating total risk", async () => {
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
    expect(personal?.totalAtRisk).toBe(66);
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
