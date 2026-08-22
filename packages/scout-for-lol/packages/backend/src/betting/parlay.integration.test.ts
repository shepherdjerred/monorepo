import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  BUCKS_INT32_MAX,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import { cancelParlayBet } from "#src/betting/parlay-cancel-bet.ts";
import type { BucksMessageEdit } from "#src/betting/message-refresh.ts";
import { refreshParlayMessages } from "#src/betting/parlay-refresh.ts";
import {
  applyBucksDelta,
  BucksStorageOverflowError,
} from "#src/betting/ledger.ts";
import { placeParlayBet } from "#src/betting/parlay-place-bet.ts";
import { activatePendingParlayMarkets } from "#src/betting/parlay-publish.ts";
import { settleParlaysForMatch } from "#src/betting/parlay-settle.ts";
import {
  closeExpiredParlayWindows,
  voidStaleParlayMarkets,
} from "#src/betting/parlay-sweep.ts";
import {
  HOUSE_ACCOUNT_DISCORD_ID,
  HOUSE_BANKROLL,
  PARLAY_BETTING_WINDOW_MS,
  VOID_GRACE_MS,
} from "#src/betting/constants.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  bucksTestDiscordId,
  bucksTestRoster,
} from "#src/testing/bucks-fixtures.ts";

const { prisma: db } = createTestDatabase("bucks-parlay");
const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const BETTOR = DiscordAccountIdSchema.parse("160509172704739328");
const SECOND_BETTOR = DiscordAccountIdSchema.parse("160509172704739329");
const MATCH_ID = fixture.metadata.matchId;
function firstParticipant() {
  const participant = fixture.info.participants[0];
  if (participant === undefined) throw new Error("fixture needs a participant");
  return participant;
}
const PARTICIPANT = firstParticipant();

function criteria(yes: boolean, opponentPings = false) {
  return {
    version: 1,
    yesProbabilityBps: 5000,
    conditions: [
      {
        kind: "participant_numeric",
        subject: "P1",
        field: "kills",
        operator: "eq",
        threshold: PARTICIPANT.kills,
      },
      {
        kind: "participant_boolean",
        subject: "P1",
        field: "win",
        expected: yes ? PARTICIPANT.win : !PARTICIPANT.win,
      },
      ...(opponentPings
        ? [
            {
              kind: "opponent_team_pings",
              field: "allInPings",
              operator: "gte",
              threshold: 1,
            },
          ]
        : []),
    ],
  };
}

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksParlayBet.deleteMany();
  await db.bucksParlayMarket.deleteMany();
  await db.bucksParlayDefinition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
}

async function makeMarket(input?: {
  yes?: boolean;
  yesProbabilityBps?: number;
  closesAt?: Date;
  opponentPings?: boolean;
}) {
  const outcome = await db.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      detectedAt: new Date(Date.now() - 60_000),
      peekAvailableAt: new Date(Date.now() + 60_000),
      closesAt: new Date(Date.now() + 10 * 60_000),
      queueType: "solo",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
    },
  });
  const yesProbabilityBps = input?.yesProbabilityBps ?? 5000;
  const definition = await db.bucksParlayDefinition.create({
    data: {
      matchId: MATCH_ID,
      queueType: "solo",
      selectedTeamId: PARTICIPANT.teamId,
      subjects: JSON.stringify([
        { key: "P1", puuid: PARTICIPANT.puuid, alias: "bryan" },
      ]),
      criteria: JSON.stringify({
        ...criteria(input?.yes ?? true, input?.opponentPings ?? false),
        yesProbabilityBps,
      }),
      yesProbabilityBps,
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
  return await db.bucksParlayMarket.create({
    data: {
      definitionId: definition.id,
      outcomePoolId: outcome.id,
      matchId: MATCH_ID,
      serverId: SERVER_ID,
      publishedAt: new Date(),
      closesAt: input?.closesAt ?? new Date(Date.now() + 5 * 60_000),
      marketState: "open",
    },
  });
}

function place(side: "YES" | "NO", stake: number) {
  return placeParlayBet(
    { matchId: MATCH_ID, serverId: SERVER_ID, discordId: BETTOR, side, stake },
    db,
  );
}

async function expectParlaySettlementBatchesHeadroom(): Promise<void> {
  const market = await makeMarket();
  const discordIds = Array.from({ length: 20 }, (_unused, index) =>
    bucksTestDiscordId(index + 100),
  );
  await db.bucksAccount.createMany({
    data: discordIds.map((discordId) => ({
      serverId: SERVER_ID,
      discordId,
      balance: 90,
    })),
  });
  const accounts = await db.bucksAccount.findMany({
    where: { discordId: { in: discordIds } },
    orderBy: { id: "asc" },
  });
  await db.bucksAccount.create({
    data: {
      serverId: SERVER_ID,
      discordId: HOUSE_ACCOUNT_DISCORD_ID,
      isHouse: true,
      balance: HOUSE_BANKROLL - accounts.length * 10,
    },
  });
  await db.bucksParlayBet.createMany({
    data: accounts.map((account, index) => ({
      marketId: market.id,
      bucksAccountId: account.id,
      side: index % 2 === 0 ? "YES" : "NO",
      stake: 10,
      houseReserve: 10,
      grossPayout: 20,
    })),
  });

  const operations: string[] = [];
  const recording = db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          operations.push(`${model}.${operation}`);
          return await query(args);
        },
      },
    },
  });

  expect(await settleParlaysForMatch(fixture, recording)).toHaveLength(1);
  const holdingsQueries = operations.filter((operation) =>
    [
      "BucksBet.aggregate",
      "BucksBet.findMany",
      "BucksBet.groupBy",
      "BucksParlayBet.aggregate",
      "BucksParlayBet.groupBy",
    ].includes(operation),
  );
  expect(holdingsQueries).toHaveLength(2);
}

beforeEach(async () => {
  await clearAll();
  clearFlagOverrides("betting_enabled");
  addFlagOverride("betting_enabled", true, { server: SERVER_ID });
  const now = new Date();
  await db.player.create({
    data: {
      alias: "bryan",
      discordId: BETTOR,
      serverId: SERVER_ID,
      creatorDiscordId: BETTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
});

afterEach(() => resetFlagOverrides("betting_enabled"));
afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("Bryan Bucks parlays", () => {
  test("accepts more than 20 BB, reserves the house, and reprices top-ups", async () => {
    await makeMarket({ yesProbabilityBps: 3333 });
    await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: BETTOR, balance: 100 },
    });
    const first = await place("YES", 21);
    expect(first).toMatchObject({
      kind: "placed",
      totalStake: 21,
      grossPayout: 64,
    });
    const second = await place("YES", 1);
    expect(second).toMatchObject({
      kind: "placed",
      totalStake: 22,
      grossPayout: 67,
    });

    const user = await db.bucksAccount.findUniqueOrThrow({
      where: { serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR } },
    });
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_ID,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(user.balance).toBe(78);
    expect(house.balance).toBe(HOUSE_BANKROLL - 45);
  });

  test("rejects a side conflict and cancellation releases both holdings", async () => {
    await makeMarket();
    const placed = await place("YES", 5);
    expect(placed.kind).toBe("placed");
    expect(await place("NO", 1)).toMatchObject({
      kind: "side_conflict",
      existingSide: "YES",
    });
    expect(
      await cancelParlayBet(
        { matchId: MATCH_ID, serverId: SERVER_ID, discordId: BETTOR },
        db,
      ),
    ).toMatchObject({ kind: "cancelled", refunded: 5, balanceAfter: 25 });
    expect(await db.bucksParlayBet.count()).toBe(0);
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_ID,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    expect(house.balance).toBe(HOUSE_BANKROLL - 25);
  });

  test("cancellation remains available after the feature flag is removed", async () => {
    await makeMarket();
    const placed = await place("YES", 5);
    expect(placed.kind).toBe("placed");
    clearFlagOverrides("betting_enabled");
    expect(
      await cancelParlayBet(
        { matchId: MATCH_ID, serverId: SERVER_ID, discordId: BETTOR },
        db,
      ),
    ).toMatchObject({ kind: "cancelled", refunded: 5 });
  });
});

describe("Bryan Bucks parlay funding and settlement", () => {
  test("rejects a tracked opponent from a parlay on opponent pings", async () => {
    await makeMarket({ opponentPings: true });
    const now = new Date();
    const opponentPuuid = bucksTestRoster()[5]?.puuid;
    if (opponentPuuid === undefined || opponentPuuid === null) {
      throw new Error("opponent fixture participant missing");
    }
    const opponent = await db.player.create({
      data: {
        alias: "opponent",
        discordId: SECOND_BETTOR,
        serverId: SERVER_ID,
        creatorDiscordId: SECOND_BETTOR,
        createdTime: now,
        updatedTime: now,
      },
    });
    await db.account.create({
      data: {
        alias: "opponent",
        puuid: opponentPuuid,
        region: "AMERICA_NORTH",
        playerId: opponent.id,
        serverId: SERVER_ID,
        creatorDiscordId: SECOND_BETTOR,
        createdTime: now,
        updatedTime: now,
      },
    });

    expect(
      await placeParlayBet(
        {
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          discordId: SECOND_BETTOR,
          side: "YES",
          stake: 5,
        },
        db,
      ),
    ).toEqual({ kind: "not_eligible" });
    expect(await db.bucksParlayBet.count()).toBe(0);
  });

  test("preserves refund headroom when a void reaches the Int32 boundary", async () => {
    await makeMarket();
    const placed = await place("YES", 5);
    expect(placed.kind).toBe("placed");
    const bet = await db.bucksParlayBet.findFirstOrThrow();
    const user = await db.bucksAccount.findUniqueOrThrow({
      where: { serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR } },
    });
    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_ID,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    await db.bucksAccount.update({
      where: { id: user.id },
      data: { balance: BUCKS_INT32_MAX - bet.stake },
    });
    await db.bucksAccount.update({
      where: { id: house.id },
      data: { balance: BUCKS_INT32_MAX - bet.houseReserve },
    });

    await expect(
      db.$transaction((tx) =>
        applyBucksDelta(tx, {
          bucksAccountId: user.id,
          delta: 1,
          kind: "adjustment",
          context: {
            type: "adjustment",
            note: "headroom test",
            actorDiscordId: BETTOR,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BucksStorageOverflowError);

    const remake = RawMatchSchema.parse({
      ...fixture,
      info: { ...fixture.info, gameDuration: 120 },
    });
    expect(await settleParlaysForMatch(remake, db)).toHaveLength(1);
    expect(
      await db.bucksAccount.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({ balance: BUCKS_INT32_MAX });
    expect(
      await db.bucksAccount.findUniqueOrThrow({ where: { id: house.id } }),
    ).toMatchObject({ balance: BUCKS_INT32_MAX });
  });

  test("house exhaustion rejects only the new placement", async () => {
    await makeMarket({ yesProbabilityBps: 1000 });
    await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: BETTOR, balance: 20_000 },
    });
    const result = await place("YES", 1112);
    expect(result.kind).toBe("house_insufficient");
    expect(await db.bucksParlayBet.count()).toBe(0);
    const user = await db.bucksAccount.findUniqueOrThrow({
      where: { serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR } },
    });
    expect(user.balance).toBe(20_000);
  });
});

describe("Bryan Bucks parlay settlement", () => {
  test("settles YES deterministically and duplicate processing is inert", async () => {
    await makeMarket();
    const placed = await place("YES", 5);
    expect(placed.kind).toBe("placed");
    const [summary] = await settleParlaysForMatch(fixture, db);
    expect(summary).toMatchObject({ yesResult: true, voidReason: undefined });
    expect(summary?.bets).toEqual([
      {
        discordId: BETTOR,
        side: "YES",
        stake: 5,
        grossPayout: 10,
        payout: 10,
        outcome: "won",
      },
    ]);
    expect(await settleParlaysForMatch(fixture, db)).toEqual([]);
    const user = await db.bucksAccount.findUniqueOrThrow({
      where: { serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR } },
    });
    expect(user.balance).toBe(30);
  });

  test("releases all market reserves before sequential settlement credits", async () => {
    await makeMarket();
    await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: BETTOR, balance: 25 },
    });
    expect(await place("NO", 5)).toMatchObject({ kind: "placed" });

    const now = new Date();
    await db.player.create({
      data: {
        alias: "alice",
        discordId: SECOND_BETTOR,
        serverId: SERVER_ID,
        creatorDiscordId: SECOND_BETTOR,
        createdTime: now,
        updatedTime: now,
      },
    });
    await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: SECOND_BETTOR, balance: 25 },
    });
    expect(
      await placeParlayBet(
        {
          matchId: MATCH_ID,
          serverId: SERVER_ID,
          discordId: SECOND_BETTOR,
          side: "YES",
          stake: 5,
        },
        db,
      ),
    ).toMatchObject({ kind: "placed" });

    const house = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: {
          serverId: SERVER_ID,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
        },
      },
    });
    await db.bucksAccount.update({
      where: { id: house.id },
      data: { balance: BUCKS_INT32_MAX - 10 },
    });

    expect(await settleParlaysForMatch(fixture, db)).toHaveLength(1);
    expect(
      await db.bucksAccount.findUniqueOrThrow({ where: { id: house.id } }),
    ).toMatchObject({ balance: BUCKS_INT32_MAX });
    expect(
      await db.bucksParlayBet.findMany({
        orderBy: { id: "asc" },
        select: { betOutcome: true },
      }),
    ).toEqual([{ betOutcome: "lost" }, { betOutcome: "won" }]);
  });

  test(
    "batches refundable-headroom reads independently of position count",
    expectParlaySettlementBatchesHeadroom,
  );

  test("isolates an initial parlay-market query failure", async () => {
    const failing = db.$extends({
      query: {
        bucksParlayMarket: {
          async findMany() {
            throw new Error("simulated parlay lookup failure");
          },
        },
      },
    });

    expect(await settleParlaysForMatch(fixture, failing)).toEqual([]);
  });

  test("settles NO when any leg misses", async () => {
    await makeMarket({ yes: false });
    const placed = await place("NO", 5);
    expect(placed.kind).toBe("placed");
    const [summary] = await settleParlaysForMatch(fixture, db);
    expect(summary).toMatchObject({ yesResult: false });
    expect(summary?.bets[0]).toMatchObject({
      side: "NO",
      outcome: "won",
      payout: 10,
    });
  });

  test("remake precedence refunds user stake and house reserve", async () => {
    await makeMarket();
    const placed = await place("YES", 5);
    expect(placed.kind).toBe("placed");
    const remake = RawMatchSchema.parse({
      ...fixture,
      info: { ...fixture.info, gameDuration: 120 },
    });
    const [summary] = await settleParlaysForMatch(remake, db);
    expect(summary).toMatchObject({
      voidReason: "remake",
      yesResult: undefined,
    });
    const accounts = await db.bucksAccount.findMany({
      orderBy: { isHouse: "asc" },
    });
    expect(
      accounts
        .map((account) => account.balance)
        .toSorted((left, right) => left - right),
    ).toEqual(
      [25, HOUSE_BANKROLL - 25].toSorted((left, right) => left - right),
    );
  });

  test("settles an empty market and stale sweep refunds active positions", async () => {
    await makeMarket();
    expect(await settleParlaysForMatch(fixture, db)).toHaveLength(1);

    await clearAll();
    const now = new Date();
    await db.player.create({
      data: {
        alias: "bryan",
        discordId: BETTOR,
        serverId: SERVER_ID,
        creatorDiscordId: BETTOR,
        createdTime: now,
        updatedTime: now,
      },
    });
    await makeMarket({ closesAt: new Date(now.getTime() - VOID_GRACE_MS - 1) });
    const placed = await placeParlayBet(
      {
        matchId: MATCH_ID,
        serverId: SERVER_ID,
        discordId: BETTOR,
        side: "YES",
        stake: 5,
        now: new Date(now.getTime() - VOID_GRACE_MS - 2),
      },
      db,
    );
    expect(placed.kind).toBe("placed");
    expect(await voidStaleParlayMarkets(db, now)).toBe(1);
    const bet = await db.bucksParlayBet.findFirstOrThrow();
    expect(bet).toMatchObject({ betOutcome: "refunded", payout: 5 });
  });
});

describe("Bryan Bucks parlay publication lifecycle", () => {
  test("voids a publishing outbox row that can no longer be activated", async () => {
    const now = new Date();
    const market = await makeMarket({
      closesAt: new Date(now.getTime() - VOID_GRACE_MS - 1),
    });
    await db.bucksParlayMarket.update({
      where: { id: market.id },
      data: {
        marketState: "publishing",
        messageRefs: JSON.stringify([
          { channelId: "channel", messageId: "message" },
        ]),
      },
    });

    const disabled: string[] = [];
    expect(
      await voidStaleParlayMarkets(db, now, async (_refs, matchId) => {
        disabled.push(matchId);
      }),
    ).toBe(1);
    expect(disabled).toEqual([MATCH_ID]);
    expect(
      await db.bucksParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
      }),
    ).toMatchObject({ marketState: "voided", voidReason: "expired" });
  });

  test("removes controls when a stale open market is voided", async () => {
    const now = new Date();
    const market = await makeMarket({
      closesAt: new Date(now.getTime() - VOID_GRACE_MS - 1),
    });
    await db.bucksParlayMarket.update({
      where: { id: market.id },
      data: {
        messageRefs: JSON.stringify([
          { channelId: "channel", messageId: "message" },
        ]),
      },
    });
    const disabled: string[] = [];

    expect(
      await voidStaleParlayMarkets(
        db,
        now,
        async () => {
          throw new Error("an open market is not a preparation message");
        },
        async (closed) => {
          disabled.push(...closed.map((entry) => entry.matchId));
        },
      ),
    ).toBe(1);
    expect(disabled).toEqual([MATCH_ID]);
  });

  test("activates an expired publication outbox with a fresh five-minute window", async () => {
    const provisionalClose = new Date(Date.now() - 1);
    const market = await makeMarket({ closesAt: provisionalClose });
    await db.bucksParlayMarket.update({
      where: { id: market.id },
      data: {
        marketState: "publishing",
        messageRefs: JSON.stringify([
          { channelId: "channel", messageId: "message" },
        ]),
      },
    });

    expect(
      await activatePendingParlayMarkets(db, MATCH_ID, {
        activateReference: async ({ ref }) => ({ ...ref }),
      }),
    ).toBe(1);
    const activated = await db.bucksParlayMarket.findUniqueOrThrow({
      where: { id: market.id },
    });
    expect(activated.marketState).toBe("open");
    expect(activated.closesAt.getTime() - activated.publishedAt.getTime()).toBe(
      PARLAY_BETTING_WINDOW_MS,
    );
    expect(activated.closesAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("voids an unpublished parlay after its outcome pool becomes terminal", async () => {
    const market = await makeMarket();
    await db.bucksParlayMarket.update({
      where: { id: market.id },
      data: {
        marketState: "publishing",
        messageRefs: JSON.stringify([
          { channelId: "channel", messageId: "message" },
        ]),
      },
    });
    await db.bucksMatchPool.update({
      where: { id: market.outcomePoolId },
      data: { poolState: "settled", winningTeamId: PARTICIPANT.teamId },
    });
    const disabled: string[] = [];

    expect(
      await activatePendingParlayMarkets(db, MATCH_ID, {
        activateReference: async ({ ref }) => ({ ...ref }),
        disableReferences: async (_refs, matchId) => {
          disabled.push(matchId);
        },
      }),
    ).toBe(0);
    expect(disabled).toEqual([MATCH_ID]);
    expect(
      await db.bucksParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
      }),
    ).toMatchObject({ marketState: "voided", voidReason: "expired" });
  });

  test("concurrent activation cannot disable the worker that opens the market", async () => {
    const market = await makeMarket();
    await db.bucksParlayMarket.update({
      where: { id: market.id },
      data: {
        marketState: "publishing",
        messageRefs: JSON.stringify([
          { channelId: "channel", messageId: "message" },
        ]),
      },
    });
    const barrier = Promise.withResolvers<undefined>();
    let activationCalls = 0;
    const disabled: string[] = [];
    const dependencies = {
      activateReference: async ({
        ref,
      }: {
        ref: { channelId: string; messageId: string };
      }) => {
        activationCalls += 1;
        if (activationCalls === 2) barrier.resolve(undefined);
        if (activationCalls <= 2) await barrier.promise;
        return { ...ref };
      },
      disableReferences: async (_refs: readonly unknown[], matchId: string) => {
        disabled.push(matchId);
      },
    };

    const results = await Promise.all([
      activatePendingParlayMarkets(db, MATCH_ID, dependencies),
      activatePendingParlayMarkets(db, MATCH_ID, dependencies),
    ]);
    expect(results.toSorted()).toEqual([0, 1]);
    expect(activationCalls).toBe(3);
    expect(disabled).toEqual([]);
    expect(
      await db.bucksParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
      }),
    ).toMatchObject({ marketState: "open" });
  });

  test("closes the five-minute parlay without closing the outcome market", async () => {
    const now = new Date();
    await makeMarket({ closesAt: new Date(now.getTime() - 1) });
    const closed = await closeExpiredParlayWindows(db, now);
    expect(closed).toHaveLength(1);
    expect(await db.bucksParlayMarket.findFirstOrThrow()).toMatchObject({
      marketState: "closed",
    });
    expect(await db.bucksMatchPool.findFirstOrThrow()).toMatchObject({
      poolState: "open",
    });
  });
});

async function marketWithMessages(): Promise<void> {
  const market = await makeMarket();
  await db.bucksParlayMarket.update({
    where: { id: market.id },
    data: {
      messageRefs: JSON.stringify([
        { channelId: "1337623164146155594", messageId: "parlay-one" },
        { channelId: "1337623164146155595", messageId: "parlay-two" },
      ]),
    },
  });
}

describe("Bryan Bucks parlay message refresh", () => {
  type RecordedEdit = {
    messageId: string;
    content: string;
    removedComponents: boolean;
  };

  function recordingEditor(edits: RecordedEdit[]): BucksMessageEdit {
    return (input) => {
      if (typeof input.options.content !== "string") {
        throw new TypeError("expected refreshed parlay content");
      }
      edits.push({
        messageId: input.messageId,
        content: input.options.content,
        removedComponents:
          Array.isArray(input.options.components) &&
          input.options.components.length === 0,
      });
      return Promise.resolve();
    };
  }

  // The file-level beforeEach already clears state and seeds the tracked
  // player; clearing again here would delete that linkage.

  // The whole point of the refresh: a placement mutates the market message
  // instead of posting a public receipt, which was ~1.8 extra messages a game.
  test("edits every market message with the live position digest", async () => {
    await marketWithMessages();
    await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: BETTOR, balance: 50 },
    });
    expect(await place("YES", 5)).toMatchObject({ kind: "placed" });
    expect(await db.bucksParlayBet.count()).toBe(1);

    const edits: RecordedEdit[] = [];
    await refreshParlayMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );

    expect(edits.map((edit) => edit.messageId)).toEqual([
      "parlay-one",
      "parlay-two",
    ]);
    expect(edits[0]?.content).toContain(`**YES** <@${BETTOR}> 5`);
    expect(edits[0]?.content).toContain("every leg must hit for YES");
    expect(edits[0]?.content).toContain("live in-play market");
    expect(edits.every((edit) => !edit.removedComponents)).toBe(true);
  });

  test("drops a cancelled position from the digest", async () => {
    await marketWithMessages();
    await db.bucksAccount.create({
      data: { serverId: SERVER_ID, discordId: BETTOR, balance: 50 },
    });
    await place("YES", 5);
    await cancelParlayBet(
      { matchId: MATCH_ID, serverId: SERVER_ID, discordId: BETTOR },
      db,
    );

    const edits: RecordedEdit[] = [];
    await refreshParlayMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );

    expect(edits[0]?.content).not.toContain(`<@${BETTOR}>`);
  });

  test("renders a voided market and strips its controls", async () => {
    await marketWithMessages();
    await db.bucksParlayMarket.updateMany({
      where: { matchId: MATCH_ID, serverId: SERVER_ID },
      data: { marketState: "voided", voidReason: "expired" },
    });

    const edits: RecordedEdit[] = [];
    await refreshParlayMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID, removeComponents: true },
      db,
      recordingEditor(edits),
    );

    expect(edits[0]?.content).toContain("Voided (the game never resolved)");
    // The raw enum must never reach a player.
    expect(edits[0]?.content).not.toContain("expired");
    expect(edits.every((edit) => edit.removedComponents)).toBe(true);
  });

  // The activation outbox owns a publishing message; refreshing it would race
  // `activatePendingParlayMarkets` for the same edit.
  test("never touches a market that is still publishing", async () => {
    await marketWithMessages();
    await db.bucksParlayMarket.updateMany({
      where: { matchId: MATCH_ID, serverId: SERVER_ID },
      data: { marketState: "publishing" },
    });

    const edits: RecordedEdit[] = [];
    await refreshParlayMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );

    expect(edits).toEqual([]);
  });

  test("is a no-op for a market with no delivered messages", async () => {
    await makeMarket();

    const edits: RecordedEdit[] = [];
    await refreshParlayMessages(
      { matchId: MATCH_ID, serverId: SERVER_ID },
      db,
      recordingEditor(edits),
    );

    expect(edits).toEqual([]);
  });
});
