import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksDareState,
} from "@scout-for-lol/data";
import { updateBettingMetrics } from "#src/metrics/betting/betting-sweep.ts";
import { bettingPendingStakeBucks } from "#src/metrics/betting/betting.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("betting-sweep-dare-escrow");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CONTRIBUTOR = bucksTestDiscordId(3);

async function clearAll(): Promise<void> {
  await db.bucksDareContribution.deleteMany();
  await db.bucksDare.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

async function dareHolding(
  dareState: BucksDareState,
  bucksAccountId: number,
  amount: number,
): Promise<void> {
  await db.bucksDare.create({
    data: {
      serverId: SERVER,
      channelId: DiscordChannelIdSchema.parse("1000000000000000001"),
      challengerDiscordId: CONTRIBUTOR,
      openingStake: amount,
      potTotal: amount,
      dareState,
      contributions: {
        create: [{ bucksAccountId, discordId: CONTRIBUTOR, amount }],
      },
    },
  });
}

async function pendingStake(): Promise<number | undefined> {
  const gauge = await bettingPendingStakeBucks.get();
  return gauge.values[0]?.value;
}

describe("the pending-stake gauge", () => {
  test("counts open Dare escrow and nothing a Dare already resolved", async () => {
    const account = await db.bucksAccount.create({
      data: { serverId: SERVER, discordId: CONTRIBUTOR, balance: 1000 },
    });
    await dareHolding("pending_accept", account.id, 3);
    await dareHolding("activating", account.id, 5);
    await dareHolding("active", account.id, 7);
    await dareHolding("achieved", account.id, 100);
    await dareHolding("voided", account.id, 200);

    await updateBettingMetrics(db);

    expect(await pendingStake()).toBe(15);
  });
});
