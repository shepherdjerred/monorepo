import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { SEED_GRANT } from "#src/betting/constants.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

const originalEnvironment = Bun.env["ENVIRONMENT"];
Bun.env["ENVIRONMENT"] = "beta";
resetConfigurationForTests();

const trpc = await createOfflineTrpcHarness("trpc-bucks-test");
const { prisma: db } = trpc;

const guildId = DiscordGuildIdSchema.parse("100000000000000061");
const otherGuildId = DiscordGuildIdSchema.parse("100000000000000062");
const actor = DiscordAccountIdSchema.parse("300000000000000061");
const rival = bucksTestDiscordId(7);
const MATCH_ID = "NA1_5000009101";

function caller() {
  return trpc.authedCaller(actor);
}

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksOpenPosition.deleteMany();
  await db.bucksWeeklyParlayBet.deleteMany();
  await db.bucksWeeklyParlayMarket.deleteMany();
  await db.bucksWeeklyParlayDefinition.deleteMany();
  await db.bucksParlayBet.deleteMany();
  await db.bucksParlayMarket.deleteMany();
  await db.bucksParlayDefinition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksWeeklyLeaderboardSnapshot.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
}

async function seedTrackedPlayer(input?: {
  discordId?: DiscordAccountId;
  serverId?: DiscordGuildId;
  alias?: string;
}): Promise<number> {
  const now = new Date();
  const player = await db.player.create({
    data: {
      alias: input?.alias ?? "jerred",
      discordId: input?.discordId ?? actor,
      serverId: input?.serverId ?? guildId,
      creatorDiscordId: input?.discordId ?? actor,
      createdTime: now,
      updatedTime: now,
    },
  });
  return player.id;
}

async function seedPool(input?: {
  closesAt?: Date;
  predictionJson?: string;
}): Promise<number> {
  const pool = await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: guildId,
      detectedAt: new Date(Date.now() - 60_000),
      peekAvailableAt: new Date(Date.now() + 60_000),
      closesAt: input?.closesAt ?? new Date(Date.now() + 5 * 60_000),
      queueType: "solo",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
      ...(input?.predictionJson === undefined
        ? {}
        : { predictionJson: input.predictionJson }),
    },
  });
  return pool.id;
}

async function seedParlayMarket(
  outcomePoolId: number,
  input?: {
    marketState?: string;
  },
): Promise<void> {
  const definition = await db.bucksParlayDefinition.create({
    data: {
      matchId: MATCH_ID,
      queueType: "solo",
      selectedTeamId: 100,
      subjects: JSON.stringify([
        { key: "P1", puuid: bucksTestPuuid(0), alias: "jerred" },
      ]),
      criteria: JSON.stringify({
        version: 1,
        yesProbabilityBps: 4000,
        conditions: [
          {
            kind: "participant_numeric",
            subject: "P1",
            field: "kills",
            operator: "gte",
            threshold: 5,
          },
          {
            kind: "participant_boolean",
            subject: "P1",
            field: "win",
            expected: true,
          },
        ],
      }),
      yesProbabilityBps: 4000,
      promptVersion: "1",
      catalogVersion: "test",
      schemaVersion: 1,
      evaluatorVersion: "1",
      generationContext: "{}",
      requestedModel: "test",
      usage: "{}",
      durationMs: 1,
    },
  });
  await db.bucksParlayMarket.create({
    data: {
      definitionId: definition.id,
      outcomePoolId,
      matchId: MATCH_ID,
      serverId: guildId,
      publishedAt: new Date(),
      closesAt: new Date(Date.now() + 5 * 60_000),
      marketState: input?.marketState ?? "open",
    },
  });
}

async function seedWeeklyMarket(playerId: number): Promise<number> {
  const openAt = new Date(Date.now() - 60 * 60_000);
  const bettingClosesAt = new Date(Date.now() + 60 * 60_000);
  const scoringStartsAt = new Date(Date.now() + 2 * 60 * 60_000);
  const scoringEndsAt = new Date(Date.now() + 26 * 60 * 60_000);
  const definition = await db.bucksWeeklyParlayDefinition.create({
    data: {
      serverId: guildId,
      periodKey: "2026-08-31",
      slot: 0,
      openAt,
      bettingClosesAt,
      scoringStartsAt,
      scoringEndsAt,
      subjects: JSON.stringify([
        {
          key: "P1",
          playerId,
          alias: "jerred",
          discordId: actor,
          accounts: [
            {
              puuid: bucksTestPuuid(0),
              trackingStartedAt: new Date(0).toISOString(),
            },
          ],
        },
      ]),
      eligibleQueues: JSON.stringify(["solo", "flex", "ranked 5s"]),
      proposal: JSON.stringify({ version: 1, legs: [] }),
      criteria: JSON.stringify({
        version: 1,
        legs: [
          {
            kind: "aggregate",
            subject: "P1",
            metric: "wins",
            operator: "gte",
            threshold: 2,
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "best_game_kills",
            operator: "gte",
            threshold: 5,
          },
          {
            kind: "aggregate",
            subject: "P1",
            metric: "longest_win_streak",
            operator: "gte",
            threshold: 2,
          },
        ],
      }),
      historySample: "[]",
      pricing: "{}",
      yesProbabilityBps: 3000,
      promptVersion: "test",
      catalogVersion: "test",
      schemaVersion: 1,
      evaluatorVersion: "1",
      pricingVersion: "1",
      generationContext: "{}",
      requestedModel: "test",
      usage: "{}",
      durationMs: 1,
    },
  });
  const market = await db.bucksWeeklyParlayMarket.create({
    data: {
      definitionId: definition.id,
      serverId: guildId,
      periodKey: "2026-08-31",
      slot: 0,
      publishedAt: openAt,
      bettingClosesAt,
      scoringEndsAt,
      marketState: "open",
    },
  });
  return market.id;
}

beforeAll(async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
  });
});

beforeEach(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("weekly_parlays_enabled");
  addFlagOverride("betting_enabled", true, { server: guildId });
  trpc.setMembership([{ guildId, asAdmin: false }]);
  await clearAll();
});

afterAll(async () => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("weekly_parlays_enabled");
  await shutdownFeatureFlags();
  await db.$disconnect();
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
});

describe("bucks.status", () => {
  test("rejects an unauthenticated caller", async () => {
    await expect(trpc.anonCaller().bucks.status()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  test("answers available with the enabled shared guilds", async () => {
    const status = await caller().bucks.status();
    expect(status).toEqual({
      state: "available",
      guilds: [{ id: guildId, name: "test-guild" }],
    });
  });

  test("answers no_shared_guild when the member shares no enabled guild", async () => {
    trpc.setMembership([{ guildId: otherGuildId, asAdmin: false }]);
    const status = await caller().bucks.status();
    expect(status).toEqual({ state: "no_shared_guild" });
  });

  test("answers feature_disabled for a declared-but-disabled guild", async () => {
    // A withdrawn guild keeps its override with value false rather than
    // deleting the entry; the probe must read that as disabled, not unknown.
    resetFlagOverrides("betting_enabled");
    addFlagOverride("betting_enabled", false, { server: guildId });
    const status = await caller().bucks.status();
    expect(status).toEqual({ state: "feature_disabled" });
  });
});

describe("bucks reads", () => {
  test("wallet answers null before any Bucks interaction", async () => {
    const wallet = await caller().bucks.wallet({ guildId });
    expect(wallet).toEqual({ eligible: false, wallet: null });
  });

  test("wallet rejects a guild outside the caller's scope", async () => {
    await expect(
      caller().bucks.wallet({ guildId: otherGuildId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("wallet reports balance, at-risk, and a computed cancellation fee", async () => {
    await seedTrackedPlayer();
    await seedPool();
    const placed = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 10,
    });
    expect(placed.kind).toBe("placed");

    const view = await caller().bucks.wallet({ guildId });
    expect(view.eligible).toBe(true);
    expect(view.wallet?.balance).toBe(SEED_GRANT - 10);
    expect(view.wallet?.totalAtRisk).toBe(10);
    expect(view.wallet?.pendingPositionCount).toBe(1);
    const position = view.wallet?.pendingPositions[0];
    if (position?.marketType !== "outcome") {
      throw new Error("Expected an outcome pending position");
    }
    expect(position.offeredStake).toBe(10);
    // 20% of 10, rounded to nearest — but asserted as the computed number.
    expect(position.cancellationFee).toBe(2);
  });

  test("ledger pages stay frozen against new entries and omit raw context", async () => {
    await seedTrackedPlayer();
    await seedPool();
    await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 3,
    });
    const first = await caller().bucks.ledger({ guildId, page: 0 });
    expect(first.snapshotId).not.toBeNull();
    expect(first.entries.map((entry) => entry.kind)).toEqual([
      "bet_stake",
      "seed",
    ]);
    expect(first.entries.every((entry) => entry.label.length > 0)).toBe(true);
    expect(first.entries.every((entry) => !("context" in entry))).toBe(true);

    await caller().bucks.cancelOutcomeBet({ guildId, matchId: MATCH_ID });
    const snapshotId = first.snapshotId ?? undefined;
    const frozen = await caller().bucks.ledger({
      guildId,
      page: 0,
      ...(snapshotId === undefined ? {} : { snapshotId }),
    });
    expect(frozen.entries.map((entry) => entry.id)).toEqual(
      first.entries.map((entry) => entry.id),
    );
    const fresh = await caller().bucks.ledger({ guildId, page: 0 });
    expect(fresh.entries.length).toBeGreaterThan(first.entries.length);
  });

  test("leaderboard answers none before the first snapshot, then the newest", async () => {
    const empty = await caller().bucks.leaderboard({ guildId });
    expect(empty).toEqual({ kind: "none" });

    await db.bucksWeeklyLeaderboardSnapshot.create({
      data: {
        serverId: guildId,
        runWeek: 100,
        postedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000),
        entryCount: 1,
        entries: JSON.stringify([{ rank: 1, discordId: rival, balance: 40 }]),
      },
    });
    await db.bucksWeeklyLeaderboardSnapshot.create({
      data: {
        serverId: guildId,
        runWeek: 101,
        entryCount: 2,
        entries: JSON.stringify([
          { rank: 1, discordId: actor, balance: 50 },
          { rank: 2, discordId: rival, balance: 30 },
        ]),
      },
    });
    const snapshot = await caller().bucks.leaderboard({ guildId });
    if (snapshot.kind !== "snapshot") {
      throw new Error("Expected a leaderboard snapshot");
    }
    expect(snapshot.entries).toEqual([
      { rank: 1, discordId: actor, balance: 50 },
      { rank: 2, discordId: rival, balance: 30 },
    ]);
  });

  test("notification preferences default on and persist partial updates", async () => {
    const defaults = await caller().bucks.notificationPreferences({ guildId });
    expect(defaults).toEqual({
      ownBetSettlementDms: true,
      betsOnPlayerSettlementDms: true,
    });
    const updated = await caller().bucks.setNotificationPreferences({
      guildId,
      ownBetSettlementDms: false,
    });
    expect(updated).toEqual({
      ownBetSettlementDms: false,
      betsOnPlayerSettlementDms: true,
    });
    const reread = await caller().bucks.notificationPreferences({ guildId });
    expect(reread).toEqual(updated);
  });
});

describe("bucks.openMarkets", () => {
  test("exposes public positions but never the pregame estimate", async () => {
    await seedTrackedPlayer();
    const playerId = await seedTrackedPlayer({
      discordId: rival,
      alias: "bryan",
    });
    const estimateMarker = "estimate-marker-0.6180339887";
    const poolId = await seedPool({
      predictionJson: JSON.stringify({
        version: 2,
        blueWinProbability: 0.62,
        marker: estimateMarker,
      }),
    });
    await seedParlayMarket(poolId);
    await seedWeeklyMarket(playerId);

    const mine = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 4,
    });
    expect(mine.kind).toBe("placed");
    const rivalCaller = trpc.authedCaller(rival);
    const theirs = await rivalCaller.bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 200,
      stake: 6,
    });
    expect(theirs.kind).toBe("placed");
    const weeklyMarket = await db.bucksWeeklyParlayMarket.findFirstOrThrow();
    const weeklyMarketId = weeklyMarket.id;
    addFlagOverride("weekly_parlays_enabled", true, { server: guildId });
    const weeklyBet = await rivalCaller.bucks.placeWeeklyParlayBet({
      guildId,
      marketId: weeklyMarketId,
      side: "YES",
      stake: 2,
    });
    expect(weeklyBet.kind).toBe("placed");

    const markets = await caller().bucks.openMarkets({ guildId });

    expect(markets.outcome).toHaveLength(1);
    const outcome = markets.outcome[0];
    if (outcome === undefined) {
      throw new Error("Expected one open outcome market");
    }
    expect(outcome.sides.map((side) => side.label)).toEqual(["Blue", "Red"]);
    expect(outcome.sides[0]?.positions).toEqual([
      { discordId: actor, stake: 4 },
    ]);
    expect(outcome.sides[1]?.positions).toEqual([
      { discordId: rival, stake: 6 },
    ]);
    expect(outcome.yourPosition).toEqual({
      teamId: 100,
      offeredStake: 4,
      cancellationFee: 1,
    });

    expect(markets.parlays).toHaveLength(1);
    expect(markets.parlays[0]?.legs.length).toBeGreaterThan(0);
    expect(markets.parlays[0]?.yesOdds.length).toBeGreaterThan(0);

    // Weekly publications are aggregate-only: bettor count + total staked.
    expect(markets.weeklyParlays).toHaveLength(1);
    const weekly = markets.weeklyParlays[0];
    expect(weekly?.bettorCount).toBe(1);
    expect(weekly?.totalStaked).toBe(2);
    expect(weekly?.yourPosition).toBeNull();
    expect(JSON.stringify(markets.weeklyParlays)).not.toContain(rival);

    // The estimate is populated on the pool and absent from the payload.
    expect(JSON.stringify(markets)).not.toContain(estimateMarker);
  });

  test("excludes publishing parlay markets", async () => {
    const poolId = await seedPool();
    await seedParlayMarket(poolId, { marketState: "publishing" });
    const markets = await caller().bucks.openMarkets({ guildId });
    expect(markets.parlays).toHaveLength(0);
  });
});

describe("bucks mutations", () => {
  test("placeOutcomeBet answers no_pool for an unknown match", async () => {
    const result = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: "NA1_missing",
      teamId: 100,
      stake: 1,
    });
    expect(result).toEqual({ kind: "no_pool" });
  });

  test("placeOutcomeBet refuses once the window has closed", async () => {
    await seedTrackedPlayer();
    await seedPool({ closesAt: new Date(Date.now() - 1000) });
    const result = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 1,
    });
    expect(result).toEqual({ kind: "window_closed" });
  });

  test("placeOutcomeBet reports insufficient balance with the shortfall", async () => {
    await seedTrackedPlayer();
    await seedPool();
    const result = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: SEED_GRANT + 5,
    });
    expect(result).toEqual({
      kind: "insufficient",
      balance: SEED_GRANT,
      needed: SEED_GRANT + 5,
    });
  });

  test("placeOutcomeBet refuses the opposing side of an open position", async () => {
    await seedTrackedPlayer();
    await seedPool();
    const first = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 2,
    });
    expect(first.kind).toBe("placed");
    const second = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 200,
      stake: 2,
    });
    expect(second).toEqual({ kind: "side_conflict", existingTeamId: 100 });
  });

  test("a top-up reprices the same position instead of opening a second", async () => {
    await seedTrackedPlayer();
    await seedPool();
    await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 2,
    });
    const topUp = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 3,
    });
    if (topUp.kind !== "placed") {
      throw new Error(`Expected a placed top-up, got ${topUp.kind}`);
    }
    expect(topUp.wasTopUp).toBe(true);
    expect(topUp.totalStake).toBe(5);
  });

  test("cancelOutcomeBet conserves the stake across refund and house cut", async () => {
    await seedTrackedPlayer();
    await seedPool();
    await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 10,
    });
    const cancelled = await caller().bucks.cancelOutcomeBet({
      guildId,
      matchId: MATCH_ID,
    });
    if (cancelled.kind !== "cancelled") {
      throw new Error(`Expected a cancellation, got ${cancelled.kind}`);
    }
    expect(cancelled.refunded + cancelled.houseCut).toBe(cancelled.stake);
    expect(cancelled.stake).toBe(10);

    const again = await caller().bucks.cancelOutcomeBet({
      guildId,
      matchId: MATCH_ID,
    });
    expect(again).toEqual({ kind: "no_bet" });
  });

  test("placeParlayBet places through the domain and refuses the other side", async () => {
    await seedTrackedPlayer();
    const poolId = await seedPool();
    await seedParlayMarket(poolId);
    const placed = await caller().bucks.placeParlayBet({
      guildId,
      matchId: MATCH_ID,
      side: "YES",
      stake: 2,
    });
    if (placed.kind !== "placed") {
      throw new Error(`Expected a placed parlay bet, got ${placed.kind}`);
    }
    expect(placed.grossPayout).toBeGreaterThan(2);
    const opposite = await caller().bucks.placeParlayBet({
      guildId,
      matchId: MATCH_ID,
      side: "NO",
      stake: 2,
    });
    expect(opposite).toEqual({ kind: "side_conflict", existingSide: "YES" });
  });

  test("placeWeeklyParlayBet needs both flags, then places", async () => {
    const playerId = await seedTrackedPlayer();
    const marketId = await seedWeeklyMarket(playerId);
    const disabled = await caller().bucks.placeWeeklyParlayBet({
      guildId,
      marketId,
      side: "YES",
      stake: 2,
    });
    expect(disabled).toEqual({ kind: "feature_disabled" });

    addFlagOverride("weekly_parlays_enabled", true, { server: guildId });
    const placed = await caller().bucks.placeWeeklyParlayBet({
      guildId,
      marketId,
      side: "YES",
      stake: 2,
    });
    expect(placed.kind).toBe("placed");
  });

  test("a failing Discord market-message refresh never fails the mutation", async () => {
    await seedTrackedPlayer();
    await seedPool();
    // Point the market message at a channel the (offline) Discord client
    // cannot reach: the post-commit refresh must swallow that failure.
    await db.bucksMatchPool.updateMany({
      data: {
        messageRefs: JSON.stringify([
          { channelId: "100000000000000900", messageId: "100000000000000901" },
        ]),
        prematchContentBase: "market message",
      },
    });
    const placed = await caller().bucks.placeOutcomeBet({
      guildId,
      matchId: MATCH_ID,
      teamId: 100,
      stake: 2,
    });
    expect(placed.kind).toBe("placed");
  });

  test("mutations reject a guild outside the caller's scope", async () => {
    await expect(
      caller().bucks.placeOutcomeBet({
        guildId: otherGuildId,
        matchId: MATCH_ID,
        teamId: 100,
        stake: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
