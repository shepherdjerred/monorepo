import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  BucksLedgerContextSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  cancelWeeklyParlayBet,
  placeWeeklyParlayBet,
} from "#src/betting/weekly-parlay-bet.ts";
import {
  captureWeeklyParlayContributions,
  weeklyContributionsForMatch,
} from "#src/betting/weekly-parlay-contribution.ts";
import {
  deliverWeeklyParlayDiscord,
  weeklyParlaySettlementActionKey,
  type WeeklyParlayDiscordSender,
} from "#src/betting/weekly-parlay-discord.ts";
import { runWeeklyParlayControlAction } from "#src/betting/weekly-parlay-control.ts";
import { openWeeklyParlay } from "#src/betting/weekly-parlay-open.ts";
import {
  WEEKLY_PARLAY_INGESTION_GRACE_MS,
  weeklyParlayFinalSettlementAt,
  weeklyParlayPeriod,
} from "#src/betting/weekly-parlay-period.ts";
import { settleWeeklyParlayMarket } from "#src/betting/weekly-parlay-settle.ts";
import {
  WeeklyParlayContributionSnapshotSchema,
  WeeklyParlaySubjectSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import {
  cancelWeeklyParlayMessage,
  type WeeklyParlayMessageEditor,
} from "#src/betting/weekly-parlay-refresh.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

const { prisma: db } = createTestDatabase("bucks-weekly-parlay-runtime");
const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);
const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const BETTOR = DiscordAccountIdSchema.parse("160509172704739328");
const PERIOD_KEY = "2026-08-24";

function participant() {
  const value = fixture.info.participants[0];
  if (value === undefined) {
    throw new Error("Rift fixture needs a participant.");
  }
  return value;
}

const PARTICIPANT = participant();
const PARTICIPANT_PUUID = LeaguePuuidSchema.parse(PARTICIPANT.puuid);
const COMPLETED_AT = new Date(fixture.info.gameEndTimestamp);
function subject(
  playerId: number,
  puuids: readonly string[] = [PARTICIPANT_PUUID],
  discordId = BETTOR,
) {
  return WeeklyParlaySubjectSchema.parse({
    key: "P1",
    playerId,
    alias: "jerred",
    discordId,
    accounts: puuids.map((puuid) => ({
      puuid: LeaguePuuidSchema.parse(puuid),
      trackingStartedAt: new Date(
        COMPLETED_AT.getTime() - 60 * 60_000,
      ).toISOString(),
    })),
  });
}

function hitCriteria() {
  return {
    version: 1,
    legs: [
      {
        kind: "aggregate",
        subject: "P1",
        metric: "games",
        operator: "gte",
        threshold: 1,
      },
      {
        kind: "aggregate",
        subject: "P1",
        metric: "kills",
        operator: "gte",
        threshold: PARTICIPANT.kills,
      },
      {
        kind: "aggregate",
        subject: "P1",
        metric: "champion_damage",
        operator: "gte",
        threshold: PARTICIPANT.totalDamageDealtToChampions,
      },
    ],
  };
}

function challengingCriteria() {
  return {
    version: 2,
    qualification: { minimumGamesPerSubject: 3 },
    legs: [
      {
        kind: "champion_peak",
        subject: "P1",
        champion: PARTICIPANT.championName,
        metric: "kills",
        operator: "gte",
        threshold: PARTICIPANT.kills,
      },
      {
        kind: "champion_peak",
        subject: "P1",
        champion: PARTICIPANT.championName,
        metric: "assists",
        operator: "gte",
        threshold: PARTICIPANT.assists,
      },
      {
        kind: "champion_games",
        subject: "P1",
        champion: PARTICIPANT.championName,
        winsOnly: true,
        operator: "gte",
        threshold: 1,
      },
    ],
  };
}

async function clearAll(): Promise<void> {
  await db.bucksLedgerEntry.deleteMany();
  await db.bucksWeeklyParlayDelivery.deleteMany();
  await db.bucksWeeklyParlayContribution.deleteMany();
  await db.bucksWeeklyParlayBet.deleteMany();
  await db.bucksWeeklyParlayMarket.deleteMany();
  await db.bucksWeeklyParlayDefinition.deleteMany();
  await db.bucksBet.deleteMany();
  await db.bucksMatchPool.deleteMany();
  await db.bucksAccount.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
}

async function makeMarket(input?: {
  criteria?: unknown;
  yesProbabilityBps?: number;
  evaluatorVersion?: string;
  schemaVersion?: number;
  marketState?: "publishing" | "open" | "active";
  slot?: number;
  subjectDiscordId?: typeof BETTOR;
  timeline?: {
    openAt: Date;
    bettingClosesAt: Date;
    scoringStartsAt: Date;
    scoringEndsAt: Date;
  };
}) {
  const player = await db.player.findFirstOrThrow({
    where: { serverId: SERVER_ID, discordId: BETTOR },
  });
  const timeline = input?.timeline ?? {
    scoringStartsAt: new Date(COMPLETED_AT.getTime() - 60 * 60_000),
    scoringEndsAt: new Date(COMPLETED_AT.getTime() + 60 * 60_000),
    openAt: new Date(COMPLETED_AT.getTime() - 3 * 60 * 60_000),
    bettingClosesAt: new Date(COMPLETED_AT.getTime() - 2 * 60 * 60_000),
  };
  const { bettingClosesAt, openAt, scoringEndsAt, scoringStartsAt } = timeline;
  const definition = await db.bucksWeeklyParlayDefinition.create({
    data: {
      serverId: SERVER_ID,
      periodKey: PERIOD_KEY,
      slot: input?.slot ?? 0,
      openAt,
      bettingClosesAt,
      scoringStartsAt,
      scoringEndsAt,
      subjects: JSON.stringify([
        subject(player.id, [PARTICIPANT_PUUID], input?.subjectDiscordId),
      ]),
      eligibleQueues: JSON.stringify(["solo", "flex", "ranked 5s"]),
      proposal: JSON.stringify({ version: 1, legs: [] }),
      criteria: JSON.stringify(input?.criteria ?? hitCriteria()),
      historySample: "[]",
      pricing: "{}",
      yesProbabilityBps: input?.yesProbabilityBps ?? 5000,
      promptVersion: "test",
      catalogVersion: "test",
      schemaVersion: input?.schemaVersion ?? 1,
      evaluatorVersion: input?.evaluatorVersion ?? "1",
      pricingVersion: "1",
      generationContext: "{}",
      requestedModel: "test",
      usage: "{}",
      durationMs: 1,
    },
  });
  return await db.bucksWeeklyParlayMarket.create({
    data: {
      definitionId: definition.id,
      serverId: SERVER_ID,
      periodKey: PERIOD_KEY,
      slot: input?.slot ?? 0,
      publishedAt: openAt,
      bettingClosesAt,
      scoringEndsAt,
      marketState: input?.marketState ?? "open",
    },
    include: { definition: true },
  });
}

function place(marketId: number, side: "YES" | "NO", stake: number) {
  return placeWeeklyParlayBet(
    {
      marketId,
      serverId: SERVER_ID,
      discordId: BETTOR,
      side,
      stake,
      now: new Date(COMPLETED_AT.getTime() - 150 * 60_000),
    },
    db,
  );
}

function challengingSnapshot(index: number) {
  return WeeklyParlayContributionSnapshotSchema.parse({
    subject: "P1",
    puuid: PARTICIPANT_PUUID,
    queue: "solo",
    completedAt: new Date(
      COMPLETED_AT.getTime() + index * 60_000,
    ).toISOString(),
    win: true,
    champion: PARTICIPANT.championName,
    role: "MIDDLE",
    kills: PARTICIPANT.kills,
    deaths: PARTICIPANT.deaths,
    assists: PARTICIPANT.assists,
    championDamage: PARTICIPANT.totalDamageDealtToChampions,
    creepScore: PARTICIPANT.totalMinionsKilled,
    gold: PARTICIPANT.goldEarned,
    visionScore: PARTICIPANT.visionScore,
    timePlayed: fixture.info.gameDuration,
  });
}

async function appendChallengingSnapshots(
  definitionId: number,
  count: number,
): Promise<void> {
  const existing = await db.bucksWeeklyParlayContribution.count({
    where: { definitionId },
  });
  for (const index of Array.from(
    { length: count },
    (_value, item) => existing + item,
  )) {
    const snapshot = challengingSnapshot(index);
    await db.bucksWeeklyParlayContribution.create({
      data: {
        definitionId,
        matchId: `weekly-v2-${index.toString()}`,
        subjectKey: snapshot.subject,
        completedAt: new Date(snapshot.completedAt),
        ingestedAt: COMPLETED_AT,
        queueType: snapshot.queue,
        snapshot: JSON.stringify(snapshot),
      },
    });
  }
}

async function makeActiveChallengingMarket() {
  const market = await makeMarket({
    criteria: challengingCriteria(),
    evaluatorVersion: "2",
    schemaVersion: 2,
    marketState: "open",
  });
  await place(market.id, "YES", 10);
  await db.bucksWeeklyParlayMarket.update({
    where: { id: market.id },
    data: { marketState: "active" },
  });
  return market;
}

function runCatchupOpen(openAt: Date, now = openAt) {
  const period = weeklyParlayPeriod(PERIOD_KEY);
  return runWeeklyParlayControlAction(
    {
      periodKey: PERIOD_KEY,
      action: "open",
      slot: 0,
      window: {
        kind: "catch_up",
        openAt: openAt.toISOString(),
        bettingClosesAt: "2026-08-25T07:00:00.000Z",
        scoringStartsAt: "2026-08-25T07:00:00.000Z",
        scoringEndsAt: period.scoringEndsAt.toISOString(),
      },
    },
    { serverId: SERVER_ID, now, prismaClient: db },
  );
}

beforeEach(async () => {
  await clearAll();
  for (const flag of ["betting_enabled", "weekly_parlays_enabled"] as const) {
    clearFlagOverrides(flag);
    addFlagOverride(flag, true, { server: SERVER_ID });
  }
  const now = new Date(COMPLETED_AT.getTime() - 24 * 60 * 60_000);
  const player = await db.player.create({
    data: {
      alias: "jerred",
      discordId: BETTOR,
      serverId: SERVER_ID,
      creatorDiscordId: BETTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.account.create({
    data: {
      alias: "jerred",
      puuid: PARTICIPANT_PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: SERVER_ID,
      creatorDiscordId: BETTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
  await db.bucksAccount.create({
    data: { serverId: SERVER_ID, discordId: BETTOR, balance: 100 },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("weekly_parlays_enabled");
});

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

describe("weekly parlay match eligibility", () => {
  test.each([
    [420, "solo"],
    [440, "flex"],
    [710, "ranked 5s"],
  ] as const)("includes exact ranked queue %i as %s", (queueId, queue) => {
    const match = RawMatchSchema.parse({
      ...fixture,
      info: { ...fixture.info, queueId },
    });
    expect(
      weeklyContributionsForMatch({ matchData: match, subjects: [subject(1)] }),
    ).toMatchObject([{ queue }]);
  });

  test.each([0, 400, 450, 700, 720, 1700])(
    "excludes non-ranked queue %i",
    (queueId) => {
      const match = RawMatchSchema.parse({
        ...fixture,
        info: { ...fixture.info, queueId },
      });
      expect(
        weeklyContributionsForMatch({
          matchData: match,
          subjects: [subject(1)],
        }),
      ).toEqual([]);
    },
  );

  test("aggregates all frozen accounts for one subject", () => {
    const secondPuuid = fixture.info.participants[1]?.puuid;
    if (secondPuuid === undefined) {
      throw new Error("Rift fixture needs a second participant.");
    }
    const frozen = subject(1, [PARTICIPANT_PUUID, secondPuuid]);
    expect(
      weeklyContributionsForMatch({ matchData: fixture, subjects: [frozen] }),
    ).toHaveLength(2);
  });

  test("extracts contributions for every frozen subject", () => {
    const secondPuuid = fixture.info.participants[1]?.puuid;
    if (secondPuuid === undefined) {
      throw new Error("Rift fixture needs a second participant.");
    }
    const secondSubject = WeeklyParlaySubjectSchema.parse({
      ...subject(1, [secondPuuid]),
      key: "P2",
      playerId: 2,
      alias: "bryan",
      discordId: bucksTestDiscordId(900),
    });
    expect(
      weeklyContributionsForMatch({
        matchData: fixture,
        subjects: [subject(1), secondSubject],
      }).map((contribution) => contribution.subject),
    ).toEqual(["P1", "P2"]);
  });
});

describe("weekly parlay ledger and settlement", () => {
  test("accepts current weekly prices below the legacy ledger range", async () => {
    const market = await makeMarket({
      yesProbabilityBps: 2273,
      schemaVersion: 2,
      evaluatorVersion: "2",
    });

    await expect(place(market.id, "YES", 10)).resolves.toMatchObject({
      kind: "placed",
      grossPayout: 44,
    });

    const entries = await db.bucksLedgerEntry.findMany({
      where: { weeklyParlayBetId: { not: null } },
    });
    expect(entries).toHaveLength(2);
    expect(
      entries.map((entry) =>
        BucksLedgerContextSchema.parse(JSON.parse(entry.context)),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ yesProbabilityBps: 2273 }),
      ]),
    );
  });

  test("reprices top-ups and cancels for free with ledger conservation", async () => {
    const market = await makeMarket();
    await expect(place(market.id, "YES", 10)).resolves.toMatchObject({
      kind: "placed",
      totalStake: 10,
      grossPayout: 20,
      wasTopUp: false,
    });
    await expect(place(market.id, "YES", 5)).resolves.toMatchObject({
      kind: "placed",
      totalStake: 15,
      grossPayout: 30,
      wasTopUp: true,
    });
    await expect(
      cancelWeeklyParlayBet(
        {
          marketId: market.id,
          serverId: SERVER_ID,
          discordId: BETTOR,
          now: new Date(COMPLETED_AT.getTime() - 150 * 60_000),
        },
        db,
      ),
    ).resolves.toMatchObject({ kind: "cancelled", refunded: 15 });
    const [wallet, ledger] = await Promise.all([
      db.bucksAccount.findUniqueOrThrow({
        where: {
          serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR },
        },
      }),
      db.bucksLedgerEntry.findMany({}),
    ]);
    const weeklyLedger = ledger.filter((entry) =>
      entry.kind.startsWith("weekly_parlay_"),
    );
    expect(wallet.balance).toBe(100);
    expect(weeklyLedger.reduce((total, entry) => total + entry.delta, 0)).toBe(
      0,
    );
    expect(
      weeklyLedger.map(
        (entry) =>
          z.object({ version: z.literal(1) }).parse(JSON.parse(entry.context))
            .version,
      ),
    ).toEqual([1, 1, 1, 1, 1, 1]);
  });

  test("flag revocation blocks new stakes but preserves cancellation", async () => {
    const market = await makeMarket();
    await expect(place(market.id, "YES", 10)).resolves.toMatchObject({
      kind: "placed",
    });
    clearFlagOverrides("weekly_parlays_enabled");
    addFlagOverride("weekly_parlays_enabled", false, { server: SERVER_ID });
    await expect(place(market.id, "YES", 1)).resolves.toEqual({
      kind: "feature_disabled",
    });
    await expect(
      cancelWeeklyParlayBet(
        {
          marketId: market.id,
          serverId: SERVER_ID,
          discordId: BETTOR,
          now: new Date(COMPLETED_AT.getTime() - 150 * 60_000),
        },
        db,
      ),
    ).resolves.toMatchObject({ kind: "cancelled", refunded: 10 });
  });

  test("serializes concurrent top-ups against one house liability", async () => {
    const market = await makeMarket();
    const results = await Promise.all([
      place(market.id, "YES", 10),
      place(market.id, "YES", 10),
    ]);
    expect(results.every((result) => result.kind === "placed")).toBe(true);
    const account = await db.bucksAccount.findUniqueOrThrow({
      where: {
        serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR },
      },
    });
    await expect(
      db.bucksWeeklyParlayBet.findUniqueOrThrow({
        where: {
          marketId_bucksAccountId: {
            marketId: market.id,
            bucksAccountId: account.id,
          },
        },
      }),
    ).resolves.toMatchObject({ stake: 20, houseReserve: 20, grossPayout: 40 });
  });
});

describe("weekly parlay operator cancellation", () => {
  test("operator cancellation refunds every bettor exactly once with balanced ledger entries", async () => {
    const featuredDiscordId = bucksTestDiscordId(703);
    const market = await makeMarket({
      marketState: "open",
      subjectDiscordId: featuredDiscordId,
    });
    const otherBettors = [bucksTestDiscordId(701), bucksTestDiscordId(702)];
    await db.player.createMany({
      data: otherBettors.map((discordId, index) => ({
        alias: `bettor-${index.toString()}`,
        discordId,
        serverId: SERVER_ID,
        creatorDiscordId: BETTOR,
        createdTime: COMPLETED_AT,
        updatedTime: COMPLETED_AT,
      })),
    });
    await db.bucksAccount.createMany({
      data: otherBettors.map((discordId) => ({
        serverId: SERVER_ID,
        discordId,
        balance: 100,
      })),
    });
    for (const [index, discordId] of [BETTOR, ...otherBettors].entries()) {
      await placeWeeklyParlayBet(
        {
          marketId: market.id,
          serverId: SERVER_ID,
          discordId,
          side: index % 2 === 0 ? "YES" : "NO",
          stake: 1,
          now: new Date(COMPLETED_AT.getTime() - 150 * 60_000),
        },
        db,
      );
    }
    const originalRefs = [
      { channelId: "160509172704739999", messageId: "original-open" },
    ];
    await db.bucksWeeklyParlayMarket.update({
      where: { id: market.id },
      data: { messageRefs: JSON.stringify(originalRefs) },
    });
    await db.bucksWeeklyParlayDelivery.create({
      data: {
        marketId: market.id,
        actionKey: "open",
        kind: "open",
        scheduledAt: market.definition.openAt,
        attemptedAt: market.definition.openAt,
        deliveredAt: market.definition.openAt,
        deliveryState: "delivered",
        messageRefs: JSON.stringify(originalRefs),
      },
    });
    clearFlagOverrides("betting_enabled");
    clearFlagOverrides("weekly_parlays_enabled");
    addFlagOverride("betting_enabled", false, { server: SERVER_ID });
    addFlagOverride("weekly_parlays_enabled", false, { server: SERVER_ID });
    const sent: Parameters<WeeklyParlayDiscordSender>[0][] = [];
    const sender: WeeklyParlayDiscordSender = async (options) => {
      sent.push(options);
      return { channelId: "160509172704739999", id: "refund-notice" };
    };
    const edits: Parameters<WeeklyParlayMessageEditor>[] = [];
    const editor: WeeklyParlayMessageEditor = async (...parameters) => {
      edits.push(parameters);
    };
    const options = {
      serverId: SERVER_ID,
      now: COMPLETED_AT,
      prismaClient: db,
      deliverDiscord: async (
        input: Parameters<typeof deliverWeeklyParlayDiscord>[0],
        prismaClient: Parameters<typeof deliverWeeklyParlayDiscord>[1],
      ) => await deliverWeeklyParlayDiscord(input, prismaClient, sender),
      cancelMessage: async (
        marketId: number,
        prismaClient: Parameters<typeof cancelWeeklyParlayMessage>[1],
      ) => await cancelWeeklyParlayMessage(marketId, prismaClient, editor),
    };
    await expect(
      runWeeklyParlayControlAction(
        { periodKey: PERIOD_KEY, slot: 0, action: "cancel" },
        options,
      ),
    ).resolves.toMatchObject({ status: "reconciled", detail: "cancelled" });
    await expect(
      runWeeklyParlayControlAction(
        { periodKey: PERIOD_KEY, slot: 0, action: "cancel" },
        options,
      ),
    ).resolves.toMatchObject({
      status: "reconciled",
      detail: "already_cancelled",
    });
    const [cancelled, bets, accounts] = await Promise.all([
      db.bucksWeeklyParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
      }),
      db.bucksWeeklyParlayBet.findMany({
        where: { marketId: market.id },
        orderBy: { id: "asc" },
      }),
      db.bucksAccount.findMany({
        where: {
          serverId: SERVER_ID,
          discordId: { in: [BETTOR, ...otherBettors] },
        },
      }),
    ]);
    const ledger = await db.bucksLedgerEntry.findMany({
      where: { weeklyParlayBetId: { in: bets.map((bet) => bet.id) } },
    });
    expect(cancelled).toMatchObject({
      marketState: "voided",
      voidReason: "operator_cancelled",
    });
    expect(bets.every((bet) => bet.betOutcome === "refunded")).toBe(true);
    expect(accounts.every((account) => account.balance === 100)).toBe(true);
    expect(
      ledger.filter((entry) => entry.kind === "weekly_parlay_refund"),
    ).toHaveLength(3);
    expect(
      ledger.filter((entry) => entry.kind === "weekly_parlay_release"),
    ).toHaveLength(3);
    expect(ledger.reduce((total, entry) => total + entry.delta, 0)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).not.toContain(`<@${featuredDiscordId}>`);
    expect(sent[0]?.allowedMentions).toEqual({
      users: [BETTOR, ...otherBettors],
    });
    expect(sent[0]?.content).toContain(
      "Weekly Bryan Bucks parlay: CANCELLED — BETS REFUNDED",
    );
    expect(sent[0]?.content).toContain("**Returned:** 3 bettors · 3 BB");
    expect(sent[0]?.components).toEqual([]);
    expect(edits).toHaveLength(2);
    expect(edits[0]?.[0]).toBe(originalRefs[0]?.channelId);
    expect(edits[0]?.[1]).toBe(originalRefs[0]?.messageId);
    expect(edits[0]?.[2].content).toContain(
      "Weekly Bryan Bucks parlay: CANCELLED — BETS REFUNDED",
    );
    expect(edits[0]?.[2].components).toEqual([]);
  });
});

describe("weekly parlay settlement", () => {
  test("never settles NO early and finalizes NO after ingestion reconciliation", async () => {
    const market = await makeMarket();
    await place(market.id, "NO", 10);
    await db.bucksWeeklyParlayMarket.update({
      where: { id: market.id },
      data: { marketState: "active" },
    });
    await expect(
      settleWeeklyParlayMarket(
        { marketId: market.id, mode: "early_yes", now: COMPLETED_AT },
        db,
      ),
    ).resolves.toBeUndefined();
    await expect(
      settleWeeklyParlayMarket(
        {
          marketId: market.id,
          mode: "final",
          now: weeklyParlayFinalSettlementAt(market.scoringEndsAt),
        },
        db,
      ),
    ).resolves.toMatchObject({ yesResult: false });
    await expect(
      db.bucksWeeklyParlayBet.findFirstOrThrow({
        where: { marketId: market.id },
      }),
    ).resolves.toMatchObject({ betOutcome: "won", payout: 20 });
  });

  test("voids an open market when finalization reveals start never ran", async () => {
    const market = await makeMarket();
    await place(market.id, "NO", 10);
    await expect(
      settleWeeklyParlayMarket(
        {
          marketId: market.id,
          mode: "final",
          now: weeklyParlayFinalSettlementAt(market.scoringEndsAt),
        },
        db,
      ),
    ).resolves.toMatchObject({
      fromState: "open",
      voidReason: "infrastructure_failure",
    });
    await expect(
      db.bucksWeeklyParlayBet.findFirstOrThrow({
        where: { marketId: market.id },
      }),
    ).resolves.toMatchObject({ betOutcome: "refunded", payout: 10 });
  });

  test("voids a market stuck in publishing at finalization", async () => {
    const market = await makeMarket();
    await place(market.id, "YES", 10);
    await db.bucksWeeklyParlayMarket.update({
      where: { id: market.id },
      data: { marketState: "publishing" },
    });
    await expect(
      settleWeeklyParlayMarket(
        {
          marketId: market.id,
          mode: "final",
          now: weeklyParlayFinalSettlementAt(market.scoringEndsAt),
        },
        db,
      ),
    ).resolves.toMatchObject({
      fromState: "publishing",
      voidReason: "infrastructure_failure",
    });
    await expect(
      db.bucksWeeklyParlayBet.findFirstOrThrow({
        where: { marketId: market.id },
      }),
    ).resolves.toMatchObject({ betOutcome: "refunded", payout: 10 });
  });

  test("settles YES early only after every persisted leg is irreversible", async () => {
    const market = await makeMarket();
    await place(market.id, "YES", 10);
    await db.bucksWeeklyParlayMarket.update({
      where: { id: market.id },
      data: { marketState: "active" },
    });
    const snapshot = weeklyContributionsForMatch({
      matchData: fixture,
      subjects: [subject(market.definition.id)],
    })[0];
    if (snapshot === undefined) {
      throw new Error("Expected a weekly contribution snapshot.");
    }
    await db.bucksWeeklyParlayContribution.create({
      data: {
        definitionId: market.definitionId,
        matchId: fixture.metadata.matchId,
        subjectKey: snapshot.subject,
        completedAt: new Date(snapshot.completedAt),
        ingestedAt: COMPLETED_AT,
        queueType: snapshot.queue,
        snapshot: JSON.stringify(snapshot),
      },
    });
    await expect(
      settleWeeklyParlayMarket(
        { marketId: market.id, mode: "early_yes", now: COMPLETED_AT },
        db,
      ),
    ).resolves.toMatchObject({ yesResult: true });
  });
});

describe("weekly parlay version-two settlement", () => {
  test("requires three eligible games before version-two early YES", async () => {
    const market = await makeActiveChallengingMarket();
    await appendChallengingSnapshots(market.definitionId, 2);
    await expect(
      settleWeeklyParlayMarket(
        { marketId: market.id, mode: "early_yes", now: COMPLETED_AT },
        db,
      ),
    ).resolves.toBeUndefined();
    await appendChallengingSnapshots(market.definitionId, 1);
    await expect(
      settleWeeklyParlayMarket(
        { marketId: market.id, mode: "early_yes", now: COMPLETED_AT },
        db,
      ),
    ).resolves.toMatchObject({ yesResult: true });
  });

  test("voids and refunds version-two markets with insufficient activity", async () => {
    const market = await makeActiveChallengingMarket();
    await appendChallengingSnapshots(market.definitionId, 2);
    await expect(
      settleWeeklyParlayMarket(
        {
          marketId: market.id,
          mode: "final",
          now: weeklyParlayFinalSettlementAt(market.scoringEndsAt),
        },
        db,
      ),
    ).resolves.toMatchObject({ voidReason: "insufficient_activity" });
    await expect(
      db.bucksWeeklyParlayBet.findFirstOrThrow({
        where: { marketId: market.id },
      }),
    ).resolves.toMatchObject({ betOutcome: "refunded", payout: 10 });
    const sent: Parameters<WeeklyParlayDiscordSender>[0][] = [];
    await deliverWeeklyParlayDiscord(
      {
        marketId: market.id,
        actionKey: weeklyParlaySettlementActionKey(market.id),
        kind: "settlement",
        scheduledAt: market.scoringEndsAt,
      },
      db,
      async (options) => {
        sent.push(options);
        return { channelId: "160509172704739999", id: "insufficient" };
      },
    );
    expect(sent[0]?.content).toContain(
      "Not every featured player completed 3 eligible games",
    );
    expect(sent[0]?.components).toEqual([]);
  });
});

describe("weekly parlay settlement failures", () => {
  test("voids and refunds every reserved position on evaluator failure", async () => {
    const market = await makeMarket();
    await place(market.id, "YES", 10);
    await db.bucksWeeklyParlayMarket.update({
      where: { id: market.id },
      data: { marketState: "active" },
    });
    await db.bucksWeeklyParlayDefinition.update({
      where: { id: market.definitionId },
      data: { evaluatorVersion: "unknown" },
    });
    await expect(
      settleWeeklyParlayMarket(
        {
          marketId: market.id,
          mode: "final",
          now: weeklyParlayFinalSettlementAt(market.scoringEndsAt),
        },
        db,
      ),
    ).resolves.toMatchObject({ voidReason: "unknown_evaluator" });
    const [wallet, bet] = await Promise.all([
      db.bucksAccount.findUniqueOrThrow({
        where: {
          serverId_discordId: { serverId: SERVER_ID, discordId: BETTOR },
        },
      }),
      db.bucksWeeklyParlayBet.findFirstOrThrow({
        where: { marketId: market.id },
      }),
    ]);
    expect(wallet.balance).toBe(100);
    expect(bet).toMatchObject({ betOutcome: "refunded", payout: 10 });
  });
});

describe("weekly parlay contributions and control actions", () => {
  test("propagates definition lookup failures so post-match ingestion retries", async () => {
    vi.spyOn(db.bucksWeeklyParlayDefinition, "findMany").mockRejectedValueOnce(
      new Error("weekly lookup unavailable"),
    );
    await expect(
      captureWeeklyParlayContributions(fixture, db, COMPLETED_AT),
    ).rejects.toThrow("weekly lookup unavailable");
  });

  test("appends independently to concurrent market slots", async () => {
    const finalOnly = hitCriteria();
    finalOnly.legs[0] = {
      kind: "aggregate",
      subject: "P1",
      metric: "games",
      operator: "eq",
      threshold: 1,
    };
    await Promise.all([
      makeMarket({ criteria: finalOnly, marketState: "active", slot: 0 }),
      makeMarket({ criteria: finalOnly, marketState: "active", slot: 1 }),
    ]);
    await expect(
      captureWeeklyParlayContributions(
        fixture,
        db,
        new Date(COMPLETED_AT.getTime() + 60_000),
      ),
    ).resolves.toBe(2);
    await expect(db.bucksWeeklyParlayContribution.count()).resolves.toBe(2);
  });

  test("reconciles duplicate starts and skips stale reminders", async () => {
    const market = await makeMarket({ marketState: "open" });
    const period = weeklyParlayPeriod(PERIOD_KEY);
    const start = { periodKey: PERIOD_KEY, action: "start" as const, slot: 0 };
    await expect(
      runWeeklyParlayControlAction(start, {
        serverId: SERVER_ID,
        now: period.scoringStartsAt,
        prismaClient: db,
      }),
    ).resolves.toMatchObject({ status: "reconciled", marketId: market.id });
    await expect(
      runWeeklyParlayControlAction(start, {
        serverId: SERVER_ID,
        now: period.scoringStartsAt,
        prismaClient: db,
      }),
    ).resolves.toMatchObject({ status: "reconciled", marketId: market.id });
    await db.bucksWeeklyParlayMarket.update({
      where: { id: market.id },
      data: { marketState: "open" },
    });
    const secondUpdate = period.updateAt[1];
    if (secondUpdate === undefined) {
      throw new Error("Weekly fixture needs a second progress update.");
    }
    await expect(
      runWeeklyParlayControlAction(
        { periodKey: PERIOD_KEY, action: "reminder", slot: 0 },
        {
          serverId: SERVER_ID,
          now: period.bettingClosesAt,
          prismaClient: db,
        },
      ),
    ).resolves.toMatchObject({ status: "skipped", detail: "stale_reminder" });
    await expect(
      runWeeklyParlayControlAction(
        {
          periodKey: PERIOD_KEY,
          action: "progress",
          slot: 0,
          updateIndex: 0,
        },
        {
          serverId: SERVER_ID,
          now: secondUpdate,
          prismaClient: db,
        },
      ),
    ).resolves.toMatchObject({ status: "skipped", detail: "stale_progress" });
  });
});

describe("weekly parlay catch-up controls", () => {
  test("rejects an open retry whose catch-up clocks conflict with the stored definition", async () => {
    await makeMarket({ marketState: "open" });
    const openAt = new Date("2026-08-24T19:00:00.000Z");
    await expect(runCatchupOpen(openAt)).rejects.toThrow(
      "conflicting timeline",
    );
  });

  test("rejects catch-up clocks that do not preserve the minimum betting window", async () => {
    const openAt = new Date("2026-08-25T02:30:00.000Z");
    await expect(runCatchupOpen(openAt)).rejects.toThrow(
      "Invalid weekly parlay catch-up timeline",
    );
  });

  test("rechecks the minimum betting window from the retry time", async () => {
    const openAt = new Date("2026-08-24T19:00:00.000Z");
    await expect(
      runCatchupOpen(openAt, new Date("2026-08-25T02:00:00.000Z")),
    ).rejects.toThrow("Invalid weekly parlay catch-up timeline");
  });

  test("allows a matching publication retry inside the generation budget", async () => {
    const period = weeklyParlayPeriod(PERIOD_KEY);
    const openAt = new Date("2026-08-24T19:00:00.000Z");
    const market = await makeMarket({
      marketState: "open",
      timeline: {
        openAt,
        bettingClosesAt: new Date("2026-08-25T07:00:00.000Z"),
        scoringStartsAt: new Date("2026-08-25T07:00:00.000Z"),
        scoringEndsAt: period.scoringEndsAt,
      },
    });
    await expect(
      openWeeklyParlay(
        {
          serverId: SERVER_ID,
          periodKey: PERIOD_KEY,
          slot: 0,
          timeline: {
            periodKey: PERIOD_KEY,
            openAt,
            bettingClosesAt: new Date("2026-08-25T07:00:00.000Z"),
            scoringStartsAt: new Date("2026-08-25T07:00:00.000Z"),
            scoringEndsAt: period.scoringEndsAt,
          },
          generationDeadline: new Date("2026-08-25T07:04:00.000Z"),
        },
        db,
      ),
    ).resolves.toMatchObject({
      kind: "existing",
      marketId: market.id,
    });
  });

  test("defers a start received before the persisted scoring clock", async () => {
    const period = weeklyParlayPeriod(PERIOD_KEY);
    const market = await makeMarket({
      marketState: "open",
      timeline: {
        openAt: period.openAt,
        bettingClosesAt: period.bettingClosesAt,
        scoringStartsAt: new Date("2026-08-26T07:00:00.000Z"),
        scoringEndsAt: period.scoringEndsAt,
      },
    });
    await expect(
      runWeeklyParlayControlAction(
        { periodKey: PERIOD_KEY, action: "start", slot: 0 },
        {
          serverId: SERVER_ID,
          now: new Date("2026-08-25T07:00:00.000Z"),
          prismaClient: db,
        },
      ),
    ).resolves.toMatchObject({
      status: "skipped",
      detail: "before_scoring_start",
      marketId: market.id,
    });
    await expect(
      db.bucksWeeklyParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
        select: { marketState: true },
      }),
    ).resolves.toMatchObject({ marketState: "open" });
  });

  test("defers progress received before the persisted update clock", async () => {
    const period = weeklyParlayPeriod(PERIOD_KEY);
    const market = await makeMarket({
      marketState: "open",
      timeline: {
        openAt: period.openAt,
        bettingClosesAt: period.bettingClosesAt,
        scoringStartsAt: new Date("2026-08-25T07:00:00.000Z"),
        scoringEndsAt: period.scoringEndsAt,
      },
    });
    await expect(
      runWeeklyParlayControlAction(
        {
          periodKey: PERIOD_KEY,
          action: "progress",
          slot: 0,
          updateIndex: 0,
        },
        {
          serverId: SERVER_ID,
          now: new Date("2026-08-25T07:00:00.000Z"),
          prismaClient: db,
        },
      ),
    ).resolves.toMatchObject({
      status: "skipped",
      detail: "before_progress_time",
      marketId: market.id,
    });
  });

  test("rejects a catch-up scoring cutoff that is not an exact Pacific midnight", async () => {
    const period = weeklyParlayPeriod(PERIOD_KEY);
    const openAt = new Date("2026-08-24T19:00:00.000Z");
    await expect(
      runWeeklyParlayControlAction(
        {
          periodKey: PERIOD_KEY,
          action: "open",
          slot: 0,
          window: {
            kind: "catch_up",
            openAt: openAt.toISOString(),
            bettingClosesAt: "2026-08-25T07:30:00.000Z",
            scoringStartsAt: "2026-08-25T07:30:00.000Z",
            scoringEndsAt: period.scoringEndsAt.toISOString(),
          },
        },
        {
          serverId: SERVER_ID,
          now: openAt,
          prismaClient: db,
        },
      ),
    ).rejects.toThrow("Invalid weekly parlay catch-up timeline");
  });
});

describe("weekly parlay contribution capture", () => {
  test("appends once and accepts a pre-cutoff completion ingested during reconciliation", async () => {
    const finalOnly = hitCriteria();
    finalOnly.legs[0] = {
      kind: "aggregate",
      subject: "P1",
      metric: "games",
      operator: "eq",
      threshold: 1,
    };
    const market = await makeMarket({
      criteria: finalOnly,
      marketState: "active",
    });
    const ingestedAt = new Date(COMPLETED_AT.getTime() + 60_000);
    await expect(
      captureWeeklyParlayContributions(fixture, db, ingestedAt),
    ).resolves.toBe(1);
    await expect(
      db.bucksWeeklyParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
      }),
    ).resolves.toMatchObject({ marketState: "active" });
    await expect(
      captureWeeklyParlayContributions(fixture, db, ingestedAt),
    ).resolves.toBe(0);
    await db.bucksWeeklyParlayContribution.deleteMany();
    await expect(
      captureWeeklyParlayContributions(
        fixture,
        db,
        new Date(market.scoringEndsAt.getTime() + 60_000),
      ),
    ).resolves.toBe(1);
  });

  test("captures a completed game while scoring start is delayed", async () => {
    const finalOnly = hitCriteria();
    finalOnly.legs[0] = {
      kind: "aggregate",
      subject: "P1",
      metric: "games",
      operator: "eq",
      threshold: 1,
    };
    const market = await makeMarket({
      criteria: finalOnly,
      marketState: "open",
    });
    await expect(
      captureWeeklyParlayContributions(fixture, db, COMPLETED_AT),
    ).resolves.toBe(1);
    await expect(
      db.bucksWeeklyParlayContribution.count({
        where: { definitionId: market.definitionId },
      }),
    ).resolves.toBe(1);
  });
});

describe("weekly parlay ingestion boundaries", () => {
  test("excludes completion at the half-open cutoff", async () => {
    const finalOnly = hitCriteria();
    finalOnly.legs[0] = {
      kind: "aggregate",
      subject: "P1",
      metric: "games",
      operator: "eq",
      threshold: 1,
    };
    const market = await makeMarket({
      criteria: finalOnly,
      marketState: "active",
    });
    const cutoffFixture = RawMatchSchema.parse({
      ...fixture,
      info: {
        ...fixture.info,
        gameEndTimestamp: market.scoringEndsAt.getTime(),
      },
    });
    await expect(
      captureWeeklyParlayContributions(
        cutoffFixture,
        db,
        new Date(
          market.scoringEndsAt.getTime() + WEEKLY_PARLAY_INGESTION_GRACE_MS - 1,
        ),
      ),
    ).resolves.toBe(0);
  });

  test("does not settle before the ingestion window and includes a late contribution", async () => {
    const finalOnly = hitCriteria();
    finalOnly.legs[0] = {
      kind: "aggregate",
      subject: "P1",
      metric: "games",
      operator: "eq",
      threshold: 1,
    };
    const market = await makeMarket({
      criteria: finalOnly,
      marketState: "active",
    });
    await expect(
      settleWeeklyParlayMarket(
        {
          marketId: market.id,
          mode: "final",
          now: new Date(
            weeklyParlayFinalSettlementAt(market.scoringEndsAt).getTime() - 1,
          ),
        },
        db,
      ),
    ).resolves.toBeUndefined();
    await expect(
      captureWeeklyParlayContributions(
        fixture,
        db,
        new Date(market.scoringEndsAt.getTime() + 60_000),
      ),
    ).resolves.toBe(1);
    await expect(
      settleWeeklyParlayMarket(
        {
          marketId: market.id,
          mode: "final",
          now: weeklyParlayFinalSettlementAt(market.scoringEndsAt),
        },
        db,
      ),
    ).resolves.toMatchObject({ yesResult: true });
  });
});

describe("weekly parlay Discord delivery", () => {
  test("uses one settlement delivery key across settlement origins", () => {
    expect(weeklyParlaySettlementActionKey(42)).toBe("settlement:42");
  });

  test("renders champion criteria and activity qualification for open and progress", async () => {
    const market = await makeMarket({
      criteria: challengingCriteria(),
      evaluatorVersion: "2",
      schemaVersion: 2,
      marketState: "publishing",
    });
    const sent: Parameters<WeeklyParlayDiscordSender>[0][] = [];
    const sender: WeeklyParlayDiscordSender = async (options) => {
      sent.push(options);
      return {
        channelId: "160509172704739999",
        id: `challenging-${sent.length.toString()}`,
      };
    };
    await deliverWeeklyParlayDiscord(
      {
        marketId: market.id,
        actionKey: "open",
        kind: "open",
        scheduledAt: market.definition.openAt,
      },
      db,
      sender,
    );
    await appendChallengingSnapshots(market.definitionId, 1);
    await db.bucksWeeklyParlayMarket.update({
      where: { id: market.id },
      data: { marketState: "active" },
    });
    await deliverWeeklyParlayDiscord(
      {
        marketId: market.id,
        actionKey: "progress:0",
        kind: "progress",
        scheduledAt: COMPLETED_AT,
      },
      db,
      sender,
    );
    expect(sent[0]?.content).toContain(
      `kills in one game as ${PARTICIPANT.championName}`,
    );
    expect(sent[0]?.content).toContain(
      "Settlement requires **3 eligible games**",
    );
    expect(sent[0]?.components).not.toEqual([]);
    expect(sent[1]?.content).toContain(
      "**Activity qualification:**\n• ⏳ **jerred** — 1/3 eligible games",
    );
    expect(sent[1]?.components).toEqual([]);
  });

  test("renders standard status and frozen betting and scoring clocks", async () => {
    const period = weeklyParlayPeriod(PERIOD_KEY);
    const market = await makeMarket({
      marketState: "publishing",
      timeline: {
        openAt: new Date("2026-08-24T19:00:00.000Z"),
        bettingClosesAt: new Date("2026-08-25T07:00:00.000Z"),
        scoringStartsAt: new Date("2026-08-25T07:00:00.000Z"),
        scoringEndsAt: period.scoringEndsAt,
      },
    });
    const sent: Parameters<WeeklyParlayDiscordSender>[0][] = [];
    const sender: WeeklyParlayDiscordSender = async (options) => {
      sent.push(options);
      return { channelId: "160509172704739999", id: "catch-up-open" };
    };
    await expect(
      deliverWeeklyParlayDiscord(
        {
          marketId: market.id,
          actionKey: "open",
          kind: "open",
          scheduledAt: market.definition.openAt,
        },
        db,
        sender,
      ),
    ).resolves.toBe("sent");
    expect(sent[0]?.content).toContain(
      "Weekly Bryan Bucks parlay: OPEN FOR BETTING",
    );
    expect(sent[0]?.content).not.toContain("Catch-up");
    expect(sent[0]?.content).toContain("**Betting closes:** <t:1787641200:F>");
    expect(sent[0]?.content).toContain(
      "**Scoring window:** <t:1787641200:F> → <t:1788112800:F>",
    );
    expect(sent[0]?.content).not.toContain("Settlement timing");
  });

  test("chunks and deduplicates private mention delivery with a stable nonce", async () => {
    const market = await makeMarket({ marketState: "open" });
    const discordIds = Array.from({ length: 25 }, (_unused, index) =>
      index === 0 ? BETTOR : bucksTestDiscordId(index + 500),
    );
    await db.bucksAccount.createMany({
      data: discordIds.slice(1).map((discordId) => ({
        serverId: SERVER_ID,
        discordId,
        balance: 10,
      })),
    });
    const accounts = await db.bucksAccount.findMany({
      where: { serverId: SERVER_ID, discordId: { in: discordIds } },
      orderBy: { id: "asc" },
    });
    await db.bucksWeeklyParlayBet.createMany({
      data: accounts.map((account) => ({
        marketId: market.id,
        bucksAccountId: account.id,
        side: account.discordId === BETTOR ? "YES" : "NO",
        stake: 1,
        houseReserve: 1,
        grossPayout: 2,
      })),
    });
    const sent: Parameters<WeeklyParlayDiscordSender>[0][] = [];
    const sender: WeeklyParlayDiscordSender = async (options) => {
      sent.push(options);
      return {
        channelId: "160509172704739999",
        id: `message-${sent.length.toString()}`,
      };
    };
    const delivery = {
      marketId: market.id,
      actionKey: "progress:0",
      kind: "progress" as const,
      scheduledAt: COMPLETED_AT,
    };
    await expect(
      deliverWeeklyParlayDiscord(delivery, db, sender),
    ).resolves.toBe("sent");
    expect(sent).toHaveLength(2);
    expect(sent[0]?.content).toContain("at least **1 game**");
    expect(sent[0]?.content).toContain("**Bets:** 25 bettors · 25 BB staked");
    const mentioned = new Set(
      sent.flatMap((options) => options.allowedMentions?.users ?? []),
    );
    expect(mentioned).toEqual(new Set(discordIds));
    expect(sent.every((options) => options.enforceNonce === true)).toBe(true);
    expect(new Set(sent.map((options) => options.nonce)).size).toBe(2);
    await expect(
      deliverWeeklyParlayDiscord(delivery, db, sender),
    ).resolves.toBe("already_sent");
    expect(sent).toHaveLength(2);
  });

  test("does not resurrect a market voided while its open message sends", async () => {
    const market = await makeMarket({ marketState: "publishing" });
    const sender: WeeklyParlayDiscordSender = async () => {
      await db.bucksWeeklyParlayMarket.update({
        where: { id: market.id },
        data: {
          marketState: "voided",
          voidReason: "infrastructure_failure",
          settledAt: COMPLETED_AT,
        },
      });
      return { channelId: "160509172704739999", id: "open-message" };
    };
    await expect(
      deliverWeeklyParlayDiscord(
        {
          marketId: market.id,
          actionKey: "open",
          kind: "open",
          scheduledAt: COMPLETED_AT,
        },
        db,
        sender,
      ),
    ).resolves.toBe("sent");
    await expect(
      db.bucksWeeklyParlayMarket.findUniqueOrThrow({
        where: { id: market.id },
      }),
    ).resolves.toMatchObject({
      marketState: "voided",
    });
    await expect(
      db.bucksWeeklyParlayDelivery.findUniqueOrThrow({
        where: {
          marketId_actionKey: { marketId: market.id, actionKey: "open" },
        },
      }),
    ).resolves.toMatchObject({ deliveryState: "delivered" });
  });
});
