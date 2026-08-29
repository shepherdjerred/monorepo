import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordGuildIdSchema,
  type BucksPoolParticipant,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { getOpenMarketsView } from "#src/betting/open-market-view.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-open-market-view");

const SERVER_ID = DiscordGuildIdSchema.parse("100000000000000071");
const VIEWER = bucksTestDiscordId(1);
const BETTOR = bucksTestDiscordId(2);
const MATCH_ID = "NA1_5000009201";

/** A roster tracked on one side only, so WIN/LOSE framing applies. */
function singleSideRoster(): BucksPoolParticipant[] {
  return bucksTestRoster().map((participant, index) =>
    index === 5 ? { ...participant, trackedAlias: undefined } : participant,
  );
}

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksOpenPosition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
}

async function seedPool(input?: {
  roster?: BucksPoolParticipant[];
  closesAt?: Date;
}): Promise<number> {
  const pool = await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      detectedAt: new Date(Date.now() - 60_000),
      peekAvailableAt: new Date(Date.now() + 60_000),
      closesAt: input?.closesAt ?? new Date(Date.now() + 5 * 60_000),
      queueType: "solo",
      roster: JSON.stringify({
        participants: input?.roster ?? bucksTestRoster(),
      }),
      predictionJson: JSON.stringify({ marker: "never-shown" }),
    },
  });
  return pool.id;
}

async function seedBet(input: {
  poolId: number;
  discordId: DiscordAccountId;
  teamId: 100 | 200;
  stake: number;
  betOutcome?: string;
  isHouse?: boolean;
}): Promise<void> {
  const account = await db.bucksAccount.upsert({
    where: {
      serverId_discordId: {
        serverId: SERVER_ID,
        discordId: input.discordId,
      },
    },
    create: {
      serverId: SERVER_ID,
      discordId: input.discordId,
      balance: 100,
      isHouse: input.isHouse ?? false,
    },
    update: {},
  });
  await db.bucksBet.create({
    data: {
      poolId: input.poolId,
      bucksAccountId: account.id,
      subjectPuuid: bucksTestPuuid(0),
      predictedTeamId: input.teamId,
      stake: input.stake,
      betOutcome: input.betOutcome ?? "pending",
    },
  });
}

beforeEach(async () => {
  await clearAll();
});

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("getOpenMarketsView", () => {
  test("frames a single-tracked-side game as WIN/LOSE from the anchor", async () => {
    await seedPool({ roster: singleSideRoster() });
    const view = await getOpenMarketsView(
      { serverId: SERVER_ID, discordId: VIEWER },
      db,
    );
    expect(view.outcome[0]?.sides.map((side) => side.label)).toEqual([
      "WIN",
      "LOSE",
    ]);
  });

  test("excludes cancelled bets, house rows, and closed pools", async () => {
    const poolId = await seedPool();
    await seedBet({ poolId, discordId: BETTOR, teamId: 100, stake: 5 });
    await seedBet({
      poolId,
      discordId: bucksTestDiscordId(3),
      teamId: 100,
      stake: 9,
      betOutcome: "cancelled",
    });
    await seedBet({
      poolId,
      discordId: bucksTestDiscordId(4),
      teamId: 200,
      stake: 7,
      isHouse: true,
    });

    const view = await getOpenMarketsView(
      { serverId: SERVER_ID, discordId: VIEWER },
      db,
    );
    const outcome = view.outcome[0];
    expect(outcome?.sides[0]?.positions).toEqual([
      { discordId: BETTOR, stake: 5 },
    ]);
    expect(outcome?.sides[0]?.totalStake).toBe(5);
    expect(outcome?.sides[1]?.positions).toEqual([]);
    expect(outcome?.yourPosition).toBeNull();
    expect(JSON.stringify(view)).not.toContain("never-shown");

    // A pool whose window already closed is not an open market.
    await db.bucksMatchPool.updateMany({
      data: { closesAt: new Date(Date.now() - 1000) },
    });
    const closed = await getOpenMarketsView(
      { serverId: SERVER_ID, discordId: VIEWER },
      db,
    );
    expect(closed.outcome).toHaveLength(0);
  });

  test("reports the caller's own offer with its computed cancellation fee", async () => {
    const poolId = await seedPool();
    await seedBet({ poolId, discordId: VIEWER, teamId: 200, stake: 10 });
    const view = await getOpenMarketsView(
      { serverId: SERVER_ID, discordId: VIEWER },
      db,
    );
    expect(view.outcome[0]?.yourPosition).toEqual({
      teamId: 200,
      offeredStake: 10,
      cancellationFee: 2,
    });
    expect(view.serverNow).toBeInstanceOf(Date);
  });
});
