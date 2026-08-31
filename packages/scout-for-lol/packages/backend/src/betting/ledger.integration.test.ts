import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksDareState,
} from "@scout-for-lol/data";
import {
  refundableBucksHeld,
  refundableBucksHeldForAccounts,
} from "#src/betting/ledger.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-dare-ledger");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CHALLENGER = bucksTestDiscordId(1);
const CONTRIBUTOR = bucksTestDiscordId(2);

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksDareContribution.deleteMany();
  await db.bucksDareGame.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDare.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

async function createDareWithContribution(input: {
  dareState: BucksDareState;
  bucksAccountId: number;
  amount: number;
}): Promise<void> {
  const dare = await db.bucksDare.create({
    data: {
      serverId: SERVER,
      channelId: DiscordChannelIdSchema.parse("1000000000000000001"),
      challengerDiscordId: CHALLENGER,
      horizonKind: "window",
      windowDays: 7,
      conditions: JSON.stringify({ version: 1 }),
      conditionVersion: 1,
      evaluatorVersion: "1",
      originalText: "I bet Virmel can't win 7 games on Warwick this month",
      proposalExpiresAt: new Date("2030-01-01T00:10:00Z"),
      dareState: input.dareState,
      potTotal: input.amount,
    },
  });
  await db.bucksDareContribution.create({
    data: {
      dareId: dare.id,
      bucksAccountId: input.bucksAccountId,
      discordId: CONTRIBUTOR,
      amount: input.amount,
    },
  });
}

describe("refundable escrow for dares", () => {
  test("counts a pending_accept contribution in both headroom queries", async () => {
    const account = await db.bucksAccount.create({
      data: { serverId: SERVER, discordId: CONTRIBUTOR, balance: 20 },
    });
    await createDareWithContribution({
      dareState: "pending_accept",
      bucksAccountId: account.id,
      amount: 5,
    });

    expect(await refundableBucksHeld(db, account.id)).toBe(5n);
    const batched = await refundableBucksHeldForAccounts(db, [
      { id: account.id, serverId: SERVER, isHouse: false },
    ]);
    expect(batched.get(account.id)).toBe(5n);
  });

  test("keeps counting while active and stops at every terminal state", async () => {
    const account = await db.bucksAccount.create({
      data: { serverId: SERVER, discordId: CONTRIBUTOR, balance: 200 },
    });
    // Distinct powers of two so the expected sum pins exactly which dare
    // states contributed: only the two open states may count.
    const contributionByState: [BucksDareState, number][] = [
      ["proposed", 1],
      ["pending_accept", 2],
      ["active", 4],
      ["achieved", 8],
      ["unachieved", 16],
      ["declined", 32],
      ["expired", 64],
      ["voided", 128],
      ["abandoned", 256],
    ];
    for (const [dareState, amount] of contributionByState) {
      await createDareWithContribution({
        dareState,
        bucksAccountId: account.id,
        amount,
      });
    }

    expect(await refundableBucksHeld(db, account.id)).toBe(6n);
    const batched = await refundableBucksHeldForAccounts(db, [
      { id: account.id, serverId: SERVER, isHouse: false },
    ]);
    expect(batched.get(account.id)).toBe(6n);
  });

  test("holds nothing against the house for another wallet's open dare", async () => {
    const contributor = await db.bucksAccount.create({
      data: { serverId: SERVER, discordId: CONTRIBUTOR, balance: 20 },
    });
    const house = await db.bucksAccount.create({
      data: {
        serverId: SERVER,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
        isHouse: true,
        balance: 10_000,
      },
    });
    await createDareWithContribution({
      dareState: "active",
      bucksAccountId: contributor.id,
      amount: 5,
    });

    // Dares reserve no house liability — the pot is the only money at risk —
    // so the guild house's headroom must not move with open dares.
    expect(await refundableBucksHeld(db, house.id)).toBe(0n);
    const batched = await refundableBucksHeldForAccounts(db, [
      { id: house.id, serverId: SERVER, isHouse: true },
      { id: contributor.id, serverId: SERVER, isHouse: false },
    ]);
    expect(batched.get(house.id)).toBe(0n);
    expect(batched.get(contributor.id)).toBe(5n);
  });
});
