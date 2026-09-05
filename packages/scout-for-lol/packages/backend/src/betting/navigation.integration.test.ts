import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  BucksLedgerKindSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  formatBucksNavigationId,
  handleBucksNavigation,
  parseBucksNavigationId,
  resolveLedgerGameLabels,
  type BucksNavigationInteraction,
} from "#src/betting/navigation.ts";
import type { BucksButtonEditReplyOptions } from "#src/betting/markets/bet-button.ts";
import { getLedgerPage } from "#src/betting/accounts.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma: db } = createTestDatabase("bucks-navigation");
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const OWNER_ID = bucksTestDiscordId(1);
const OTHER_ID = bucksTestDiscordId(2);

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksWeeklyParlayBet.deleteMany();
  await db.bucksWeeklyParlayMarket.deleteMany();
  await db.bucksWeeklyParlayDefinition.deleteMany();
  await db.bucksAccount.deleteMany();
}

beforeEach(clearAll);

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

function fakeNavigation(customId: string, userId = OWNER_ID) {
  const calls: string[] = [];
  const replies: BucksButtonEditReplyOptions[] = [];
  const interaction: BucksNavigationInteraction = {
    customId,
    guildId: SERVER_ID,
    user: { id: userId },
    deferReply: vi.fn(() => {
      calls.push("deferReply");
      return Promise.resolve(undefined);
    }),
    deferUpdate: vi.fn(() => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    }),
    editReply: vi.fn((options: BucksButtonEditReplyOptions) => {
      calls.push("editReply");
      replies.push(options);
      return Promise.resolve(undefined);
    }),
  };
  return { interaction, calls, replies };
}

async function createHistory(count: number) {
  const account = await db.bucksAccount.create({
    data: { serverId: SERVER_ID, discordId: OWNER_ID, balance: count },
  });
  for (let index = 1; index <= count; index++) {
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: 1,
        balanceAfter: index,
        kind: "adjustment",
        context: JSON.stringify({ type: "adjustment", note: "test" }),
      },
    });
  }
  return account;
}

describe("Bryan Bucks history navigation", () => {
  test("round-trips the versioned caller-bound ID", () => {
    const input = {
      action: "h" as const,
      ownerId: OWNER_ID,
      snapshotId: 123,
      page: 2,
    };
    expect(parseBucksNavigationId(formatBucksNavigationId(input))).toEqual(
      input,
    );
  });

  test("rejects a click from anyone except the original caller", async () => {
    await createHistory(12);
    const first = await getLedgerPage(
      { serverId: SERVER_ID, discordId: OWNER_ID, page: 0 },
      db,
    );
    if (first.snapshotId === null) {
      throw new Error("The populated ledger did not produce a snapshot ID");
    }
    const { interaction, calls, replies } = fakeNavigation(
      formatBucksNavigationId({
        action: "h",
        ownerId: OWNER_ID,
        snapshotId: first.snapshotId,
        page: 1,
      }),
      OTHER_ID,
    );

    await handleBucksNavigation(interaction, db);

    expect(calls).toEqual(["deferReply", "editReply"]);
    expect(replies[0]?.content).toContain("Only the person");
    expect(replies[0]?.content).not.toContain("BB history");
  });

  test("loads the requested frozen page for its owner", async () => {
    const account = await createHistory(12);
    const first = await getLedgerPage(
      { serverId: SERVER_ID, discordId: OWNER_ID, page: 0 },
      db,
    );
    if (first.snapshotId === null) {
      throw new Error("The populated ledger did not produce a snapshot ID");
    }
    await db.bucksLedgerEntry.create({
      data: {
        bucksAccountId: account.id,
        delta: 50,
        balanceAfter: 62,
        kind: "adjustment",
        context: JSON.stringify({ type: "adjustment", note: "new" }),
      },
    });
    const { interaction, calls, replies } = fakeNavigation(
      formatBucksNavigationId({
        action: "h",
        ownerId: OWNER_ID,
        snapshotId: first.snapshotId,
        page: 1,
      }),
    );

    await handleBucksNavigation(interaction, db);

    expect(calls).toEqual(["deferUpdate", "editReply"]);
    expect(replies[0]?.content).toContain("Page 2/2");
    expect(replies[0]?.content).toContain("→ 2 BB");
    expect(replies[0]?.content).toContain("→ 1 BB");
    expect(replies[0]?.content).not.toContain("→ 62 BB");
  });
});

describe("resolveLedgerGameLabels", () => {
  test("labels rows from context aliases, rosters, and weekly subjects", async () => {
    const account = await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: OWNER_ID, balance: 40 },
    });
    await db.bucksMatchPool.create({
      data: {
        matchId: "NA1_labels_1",
        serverId: SERVER_ID,
        detectedAt: new Date("2030-01-01T00:00:00Z"),
        closesAt: new Date("2030-01-01T00:10:00Z"),
        roster: JSON.stringify({
          participants: bucksTestRoster(),
        }),
      },
    });
    const definition = await db.bucksWeeklyParlayDefinition.create({
      data: {
        serverId: SERVER_ID,
        periodKey: "2030-01-06",
        slot: 0,
        openAt: new Date("2030-01-06T00:00:00Z"),
        bettingClosesAt: new Date("2030-01-07T00:00:00Z"),
        scoringStartsAt: new Date("2030-01-06T00:00:00Z"),
        scoringEndsAt: new Date("2030-01-13T00:00:00Z"),
        subjects: JSON.stringify([
          {
            key: "P1",
            playerId: 1,
            alias: "jerred",
            discordId: bucksTestDiscordId(1),
            accounts: [
              {
                puuid: bucksTestPuuid(0),
                trackingStartedAt: "2029-01-01T00:00:00.000Z",
              },
            ],
          },
          {
            key: "P2",
            playerId: 2,
            alias: "bryan",
            discordId: bucksTestDiscordId(2),
            accounts: [
              {
                puuid: bucksTestPuuid(1),
                trackingStartedAt: "2029-01-01T00:00:00.000Z",
              },
            ],
          },
        ]),
        eligibleQueues: "[]",
        proposal: "{}",
        criteria: "{}",
        historySample: "{}",
        pricing: "{}",
        yesProbabilityBps: 2500,
        promptVersion: "test",
        catalogVersion: "test",
        schemaVersion: 2,
        evaluatorVersion: "2",
        pricingVersion: "2",
        generationContext: "{}",
        requestedModel: "test",
        usage: "{}",
        durationMs: 1,
      },
    });

    const entries = [
      {
        id: 1,
        delta: -5,
        balanceAfter: 35,
        kind: BucksLedgerKindSchema.parse("bet_stake"),
        matchId: "NA1_other",
        context: JSON.stringify({
          type: "stake",
          subjectAlias: "jerred",
          subjectPuuid: bucksTestPuuid(0),
          backedAliases: ["jerred"],
          opposingAliases: ["bryan"],
        }),
        createdAt: new Date(0),
      },
      {
        id: 2,
        delta: 1,
        balanceAfter: 36,
        kind: BucksLedgerKindSchema.parse("earn_game"),
        matchId: "NA1_labels_1",
        context: JSON.stringify({
          type: "earn",
          alias: "jerred",
          puuid: bucksTestPuuid(0),
          championName: "Ahri",
          teamPosition: "MIDDLE",
          queueType: "solo",
          won: true,
        }),
        createdAt: new Date(0),
      },
      {
        id: 3,
        delta: -1,
        balanceAfter: 35,
        kind: BucksLedgerKindSchema.parse("weekly_parlay_stake"),
        matchId: null,
        context: JSON.stringify({
          type: "weekly_parlay_stake",
          version: 1,
          definitionId: definition.id,
          periodKey: "2030-01-06",
          slot: 0,
          side: "YES",
          yesProbabilityBps: 2500,
          totalStake: 1,
          quotedGrossPayout: 4,
        }),
        createdAt: new Date(0),
      },
      {
        id: 4,
        delta: 20,
        balanceAfter: 55,
        kind: BucksLedgerKindSchema.parse("seed"),
        matchId: null,
        context: JSON.stringify({ type: "seed", note: "welcome" }),
        createdAt: new Date(0),
      },
    ];

    const labels = await resolveLedgerGameLabels(SERVER_ID, entries, db);
    // Outcome rows resolve from their frozen context with no lookup.
    expect(labels.get(1)).toBe("jerred, bryan");
    // Earn rows resolve through the pool's frozen roster.
    expect(labels.get(2)).toContain("jerred");
    // Weekly rows resolve through their definition's frozen subjects.
    expect(labels.get(3)).toBe("weekly · jerred, bryan");
    // A seed has no game; the renderer shows nothing for it.
    expect(labels.has(4)).toBe(false);
    expect(account.id).toBeGreaterThan(0);
  });

  // Regression: PlayerAliasSchema allows aliases up to 100 characters, so
  // three of them on one outcome-bet row could run past a thousand
  // characters on their own. Capping only the alias *count* was not enough
  // to keep a ten-row page under Discord's 2000-character content limit.
  test("caps a resolved label by character length, not only alias count", async () => {
    const longAlias = "x".repeat(100);
    const entries = [
      {
        id: 1,
        delta: -5,
        balanceAfter: 35,
        kind: BucksLedgerKindSchema.parse("bet_stake"),
        matchId: "NA1_long",
        context: JSON.stringify({
          type: "stake",
          subjectAlias: longAlias,
          subjectPuuid: bucksTestPuuid(0),
          backedAliases: [longAlias],
          opposingAliases: [longAlias, `${longAlias}2`],
        }),
        createdAt: new Date(0),
      },
    ];

    const labels = await resolveLedgerGameLabels(SERVER_ID, entries, db);
    const label = labels.get(1);
    if (label === undefined) {
      throw new Error("expected a resolved label for the long-alias row");
    }
    expect(label.length).toBeLessThanOrEqual(61);
    expect(label.endsWith("…")).toBe(true);
  });
});

function dareContext(input: {
  role: "contributor" | "target";
  payoutComponent: "contribution" | "share";
  resolution?: "achieved";
}): string {
  return JSON.stringify({
    type: "dare",
    dareId: 7,
    role: input.role,
    targetAliases: ["alpha", "bravo"],
    conditionSummary: "alpha and bravo each win at least 1 game",
    potTotal: 10,
    amount: 5,
    payoutComponent: input.payoutComponent,
    ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
  });
}

// Regression: a dare_payout row carries a matchId but no BucksMatchPool, so
// before dare contexts were handled it fell through to the roster lookup,
// found nothing, and rendered the raw Riot match ID. Dares freeze their
// target aliases precisely so history never has to look anything up.
describe("resolveLedgerGameLabels for dares", () => {
  test("renders frozen target aliases with or without a match ID", async () => {
    const entries = [
      {
        id: 1,
        delta: 4,
        balanceAfter: 39,
        kind: BucksLedgerKindSchema.parse("dare_payout"),
        // A settled dare stamps the binding match, and there is no pool for it.
        matchId: "NA1_dare_settlement",
        context: dareContext({
          role: "target",
          payoutComponent: "share",
          resolution: "achieved",
        }),
        createdAt: new Date(0),
      },
      {
        id: 2,
        delta: -5,
        balanceAfter: 35,
        kind: BucksLedgerKindSchema.parse("dare_stake"),
        // A contribution predates any match.
        matchId: null,
        context: dareContext({
          role: "contributor",
          payoutComponent: "contribution",
        }),
        createdAt: new Date(0),
      },
    ];

    const labels = await resolveLedgerGameLabels(SERVER_ID, entries, db);
    expect(labels.get(1)).toBe("alpha, bravo");
    expect(labels.get(2)).toBe("alpha, bravo");
    // Never the raw match ID, and never a pool lookup that has no pool.
    expect(labels.get(1)).not.toContain("NA1_dare_settlement");
  });
});
