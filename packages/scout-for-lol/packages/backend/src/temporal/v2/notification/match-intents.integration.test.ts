import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId } from "#src/testing/test-ids.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  deliveryIntentKey,
  lateBindingEarningsDeliveryKeyPrefix,
  prematchDeliveryKeyPrefix,
  settlementDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import { BucksPoolTotalSchema, RiotTeamIdSchema } from "@scout-for-lol/data";

/**
 * What a post-match match mints, against real rows.
 *
 * The question these cover is not "does an intent get written" — the prematch
 * lane already proves the write discipline — but WHICH matches may write one
 * at all. A `silent-backfill` match must leave no evidence that a delivery was
 * intended: no intent row, in any state, for any kind.
 */

const { prisma } = createTestDatabase("scout-v2-match-intents");

const MATCH = RiotMatchIdSchema.parse("NA1_8300");
const SILENT_MATCH = RiotMatchIdSchema.parse("NA1_8301");
const CHANNEL = "100000000000000021";
const SETTLEMENT_CHANNEL = "100000000000000031";
const GUILD = testGuildId("4200");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

type PreparedStub = {
  refs: { channelId: string; messageId: string }[];
  kind: "message" | "pool-missing" | "nothing-to-report";
};
const prepared: PreparedStub = vi.hoisted(() => ({
  refs: [{ channelId: "100000000000000031", messageId: "9001" }],
  kind: "message",
}));

// v1's own announcement decision, replaced so these tests are about the
// MINTING rules rather than about pool rows: what v1 refuses to announce must
// mint nothing, and what it announces must mint one row per watching channel.
vi.mock("#src/betting/notify/announce-prepare.ts", () => ({
  prepareSettlementAnnouncement: () =>
    Promise.resolve(
      prepared.kind === "message"
        ? {
            kind: "message",
            message: {},
            refs: prepared.refs,
            showOutcome: true,
            unmatchedPositions: [],
            roster: [],
            queueType: null,
          }
        : { kind: prepared.kind },
    ),
  outcomeIsVisible: () => true,
}));

// The audience is v1's own resolver; the channels it returns are not what
// these tests are about, so it answers one subscribed channel for every match.
vi.mock("#src/league/tasks/notification-filters.ts", () => ({
  resolvePostmatchDeliveryChannels: () =>
    Promise.resolve({
      subscribed: [],
      deliverable: [{ channel: CHANNEL, serverId: GUILD, subscriptions: [] }],
      guildIds: [GUILD],
    }),
}));

const {
  mintDareSummaryIntentsV2,
  mintLateBindingEarningIntentsV2,
  mintPostmatchIntentsV2,
  mintSettlementIntentsV2,
} = await import("#src/temporal/v2/notification/match-intents.ts");
const { observeMatch, getObservation } =
  await import("#src/database/durable/observation-repository.ts");
const { listIntentsForMatch, upsertIntent } =
  await import("#src/database/durable/intent-repository.ts");
const { planMatchFanOutV2 } = await import("#src/temporal/v2/match-reads.ts");
const { recoveredAnnouncementsOf, settlementAnnouncementInputs } =
  await import("#src/temporal/v2/notification/match-intents.ts");
const { listSettlementAnnouncementItems, recordSettlementAnnouncementItem } =
  await import("#src/database/durable/settlement-announcement-repository.ts");
const { settlementAnnouncementItemsOf } =
  await import("#src/temporal/v2/notification/match-intents.test-fixtures.ts");
const { monetaryAnnouncementFreshnessDeadline } =
  await import("#src/temporal/v2/notification/match-intents.ts");
const { postmatchReportFreshnessDeadline } =
  await import("#src/league/tasks/postmatch/match-report-delivery.ts");
const { toIsoInstant } = await import("#src/durable/match/match-identity.ts");

const GAME_CREATED_AT = Date.parse("2026-09-19T09:00:00.000Z");

async function observe(
  matchId: string,
  deliveryMode: "live" | "silent-backfill",
): Promise<void> {
  await observeMatch(prisma, {
    matchId: RiotMatchIdSchema.parse(matchId),
    platformRoute: PlatformRouteSchema.parse("NA1"),
    policy: "FULL",
    deliveryMode,
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-19T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-19T09:30:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
}

function mint(matchId: string) {
  return mintPostmatchIntentsV2(prisma, {
    matchId: RiotMatchIdSchema.parse(matchId),
    puuids: [],
    queue: { queueId: 420, gameMode: "CLASSIC", gameType: "MATCHED_GAME" },
    gameCreation: GAME_CREATED_AT,
    createdAt: new Date("2026-09-19T09:35:00.000Z"),
  });
}

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.matchSettlementAnnouncement.deleteMany();
  await prisma.matchObservation.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("what a post-match match mints", () => {
  test("mints the report for a live match", async () => {
    await observe(MATCH, "live");

    expect(await mint(MATCH)).toEqual({
      minted: 1,
      existing: 0,
      conflicts: 0,
      silent: 0,
      undeliverable: 0,
    });
    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.intent.kind).toBe("postmatch");
    expect(intents[0]?.intent.origin).toEqual({ kind: "live" });
    expect(intents[0]?.intent.state).toEqual({ kind: "pending" });
  });

  test("mints NOTHING for a silent-backfill match", async () => {
    // The whole point of the mode. Not a suppressed row, not a row nobody
    // drives — no row at all, because the row is the evidence that a delivery
    // was intended and the backlog gauge and the sweep both read it.
    await observe(SILENT_MATCH, "silent-backfill");

    expect(await mint(SILENT_MATCH)).toEqual({
      minted: 0,
      existing: 0,
      conflicts: 0,
      silent: 1,
      undeliverable: 0,
    });
    expect(
      await listIntentsForMatch(prisma, { matchId: SILENT_MATCH }),
    ).toEqual([]);
  });

  test("is read-gated, so a retry mints nothing new", async () => {
    await observe(MATCH, "live");
    await mint(MATCH);

    expect(await mint(MATCH)).toMatchObject({ minted: 0, existing: 1 });
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toHaveLength(
      1,
    );
  });

  test("refuses to mint for a match nothing has observed", async () => {
    // Every minting site runs after the observation commit, so no observation
    // is a broken caller contract. Defaulting either way is unrecoverable:
    // one announces a backfill, the other silences a live match.
    await expect(mint(MATCH)).rejects.toThrow(
      /owed a public delivery is unknown/,
    );
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);
  });

  test("reads the mode from the row, not from the caller", async () => {
    // A caller cannot talk this into minting: there is no parameter to pass.
    // Flipping the committed row is the only thing that changes the answer,
    // and the observation claim is what defends that row against drift.
    await observe(SILENT_MATCH, "silent-backfill");
    expect(await mint(SILENT_MATCH)).toMatchObject({ silent: 1, minted: 0 });

    const stored = await getObservation(prisma, { matchId: SILENT_MATCH });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });
});

function dareSummary(
  overrides: Partial<DareSettlementSummary>,
): DareSettlementSummary {
  return {
    dareId: 77,
    serverId: GUILD,
    channelId: "100000000000000041",
    messageRef: "7",
    matchId: MATCH,
    resolution: "achieved",
    horizonKind: "next_game",
    challengerDiscordId: "1",
    targetAliases: ["a"],
    conditionSummary: "do a thing",
    potTotal: 10,
    payouts: [],
    refunds: [],
    voidReason: undefined,
    leafCounts: undefined,
    ...overrides,
  };
}

describe("what the settlement effect mints", () => {
  const settlement: SettlementSummary = {
    matchId: MATCH,
    serverId: GUILD,
    winningTeamId: undefined,
    voidReason: undefined,
    winnersPool: BucksPoolTotalSchema.parse(0),
    losersPool: BucksPoolTotalSchema.parse(0),
    houseCut: BucksPoolTotalSchema.parse(0),
    bets: [],
  };

  test("gives the recap a deadline money can still reach", async () => {
    // It used to borrow the REPORT's window. A match report is news about a
    // game and goes stale; a settlement notice is a receipt for money that
    // already moved, and v1 never applied the report's age check to it. A
    // live match processed after an outage or repeated retries therefore
    // minted an intent that was already expired, the send was refused, and
    // nobody was told what they were paid.
    await observe(MATCH, "live");
    prepared.kind = "message";

    await mintSettlementIntentsV2(prisma, {
      matchId: MATCH,
      closures: [],
      settlements: [settlement],
      parlaySettlements: [],
      earnings: [],
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T09:35:00.000Z"),
    });

    const [minted] = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(minted?.intent.freshnessDeadline).toBe(
      toIsoInstant(monetaryAnnouncementFreshnessDeadline(GAME_CREATED_AT)),
    );
    // And strictly later than the report's, which is the defect: equal means
    // the recap expires when the report does.
    expect(
      monetaryAnnouncementFreshnessDeadline(GAME_CREATED_AT).getTime(),
    ).toBeGreaterThan(
      postmatchReportFreshnessDeadline(GAME_CREATED_AT).getTime(),
    );
  });

  test("mints one recap per channel the pool's bettors are watching", async () => {
    await observe(MATCH, "live");
    prepared.kind = "message";

    const summary = await mintSettlementIntentsV2(prisma, {
      matchId: MATCH,
      closures: [],
      settlements: [settlement],
      parlaySettlements: [],
      earnings: [],
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T09:35:00.000Z"),
    });

    expect(summary).toMatchObject({ minted: 1, undeliverable: 0 });
    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(intents[0]?.intent.kind).toBe("settlement");
    expect(intents[0]?.intent.announcement).toBeDefined();
  });

  test("mints late-binding earnings under a distinct durable intent", async () => {
    await observe(MATCH, "live");
    prepared.kind = "message";

    await mintSettlementIntentsV2(prisma, {
      matchId: MATCH,
      closures: [],
      settlements: [settlement],
      parlaySettlements: [],
      earnings: [],
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T09:35:00.000Z"),
    });
    await mintLateBindingEarningIntentsV2(prisma, {
      matchId: MATCH,
      earnings: [
        {
          serverId: GUILD,
          discordId: "100000000000000051",
          alias: "late player",
          reasons: ["played"],
          total: 1,
        },
      ],
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T09:40:00.000Z"),
    });

    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    const keys = intents.map((record) => record.intent.key);
    expect(keys).toContain(
      deliveryIntentKey(settlementDeliveryKeyPrefix(MATCH), SETTLEMENT_CHANNEL),
    );
    expect(keys).toContain(
      deliveryIntentKey(
        lateBindingEarningsDeliveryKeyPrefix(MATCH),
        SETTLEMENT_CHANNEL,
      ),
    );
  });

  test("mints nothing when v1 has nothing to announce", async () => {
    // `pool-missing` and `nothing-to-report` are v1's own refusals. A row for
    // either would be an intent the delivery arm then declines to render.
    await observe(MATCH, "live");
    for (const kind of ["pool-missing", "nothing-to-report"] as const) {
      prepared.kind = kind;
      expect(
        await mintSettlementIntentsV2(prisma, {
          matchId: MATCH,
          closures: [],
          settlements: [settlement],
          parlaySettlements: [],
          earnings: [],
          gameCreation: GAME_CREATED_AT,
          createdAt: new Date("2026-09-19T09:35:00.000Z"),
        }),
      ).toMatchObject({ minted: 0 });
    }
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);
  });

  test("mints nothing, and says so, when there is nowhere to announce", async () => {
    // v1 refuses to substitute a channel nobody opted into; so does this.
    await observe(MATCH, "live");
    prepared.kind = "message";
    prepared.refs = [];

    expect(
      await mintSettlementIntentsV2(prisma, {
        matchId: MATCH,
        closures: [],
        settlements: [settlement],
        parlaySettlements: [],
        earnings: [],
        gameCreation: GAME_CREATED_AT,
        createdAt: new Date("2026-09-19T09:35:00.000Z"),
      }),
    ).toMatchObject({ minted: 0, undeliverable: 1 });
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);
    prepared.refs = [{ channelId: "100000000000000031", messageId: "9001" }];
  });

  test("withholds the recap entirely for a silent-backfill match", async () => {
    await observe(SILENT_MATCH, "silent-backfill");
    prepared.kind = "message";

    expect(
      await mintSettlementIntentsV2(prisma, {
        matchId: SILENT_MATCH,
        closures: [],
        settlements: [{ ...settlement, matchId: SILENT_MATCH }],
        parlaySettlements: [],
        earnings: [],
        gameCreation: GAME_CREATED_AT,
        createdAt: new Date("2026-09-19T09:35:00.000Z"),
      }),
    ).toMatchObject({ minted: 0, silent: 1 });
    expect(
      await listIntentsForMatch(prisma, { matchId: SILENT_MATCH }),
    ).toEqual([]);
  });

  test("mints one Dare summary, and none for a resolution that announces nothing", async () => {
    await observe(MATCH, "live");

    const summary = await mintDareSummaryIntentsV2(prisma, {
      matchId: MATCH,
      dareSettlements: [
        dareSummary({}),
        dareSummary({ dareId: 78, resolution: "captured" }),
        dareSummary({ dareId: 79, resolution: "abandoned" }),
        // Not this match's: a deadline resolution belongs to maintenance.
        dareSummary({ dareId: 80, matchId: undefined }),
      ],
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T09:35:00.000Z"),
    });

    expect(summary).toMatchObject({ minted: 1 });
    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.intent.kind).toBe("dare-summary");
  });
});

describe("what the post-match fan-out drives", () => {
  test("never drives a prematch intent, however fresh it still is", async () => {
    // The hazard is this Activity's TIMING, not its routing. A prematch intent
    // announces a game STARTING and this runs when the game is known to have
    // ended — but the freshness deadline is the game's own three-hour TTL, so
    // a match discovered minutes after it finished is still well inside it.
    // A prematch row an outage left `pending` would therefore pass `beginSend`
    // and post "game starting" after the result was already known.
    await observe(MATCH, "live");
    const prematchKey = NotificationIntentKeySchema.parse(
      deliveryIntentKey(prematchDeliveryKeyPrefix(MATCH), CHANNEL),
    );
    await upsertIntent(prisma, {
      matchId: MATCH,
      intent: {
        key: prematchKey,
        kind: "prematch",
        origin: { kind: "live" },
        target: {
          kind: "channel",
          channelId: DiscordChannelIdSchema.parse(CHANNEL),
        },
        // Deliberately far in the future: the deadline is not what saves us.
        freshnessDeadline: IsoInstantSchema.parse("2099-01-01T00:00:00.000Z"),
        createdAt: IsoInstantSchema.parse("2026-09-19T09:05:00.000Z"),
        attemptCount: 0,
        state: { kind: "pending" },
      },
    });
    await mint(MATCH);

    const plan = await planMatchFanOutV2({ riotMatchId: MATCH });

    expect(plan.notificationIntentKeys).not.toContain(prematchKey);
    // The report for the same match and channel is still driven, so this is
    // an exclusion of the KIND and not of the match or the channel.
    expect(plan.notificationIntentKeys).toHaveLength(1);
  });
});

describe("the fold a recovered settlement announces from", () => {
  /**
   * The set folded from checkpoints must equal the set folded live, or a
   * takeover announces something the original run would not have.
   *
   * The data is chosen to discriminate rather than to pass. `buildAnnouncements`
   * folds in two cases a naive per-item recovery drops: a CLOSURE carrying
   * positions but no settlement of its own, which becomes a zero summary, and
   * a PARLAY whose pool settled on an earlier tick, which has no settlement
   * beside it. A recovery that walked the stored items one at a time would
   * announce neither.
   */
  const SETTLED_GUILD = "guild-settled";
  const CLOSURE_ONLY_GUILD = "guild-closure-only";
  const PARLAY_ONLY_GUILD = "guild-parlay-only";

  function live() {
    return {
      closures: [
        {
          matchId: MATCH,
          serverId: CLOSURE_ONLY_GUILD,
          messageRefs: [{ channelId: "c1", messageId: "m1" }],
          humanMatchedPerSide: 0,
          houseFill: 0,
          totalMatchedPerSide: 0,
          // Positions with NO matched stake: the case that becomes a zero
          // summary rather than being dropped.
          positions: [
            {
              betId: 1,
              discordId: "d1",
              teamId: RiotTeamIdSchema.parse(100),
              submittedStake: 10,
              matchedStake: 0,
              unmatchedStake: 10,
            },
          ],
        },
      ],
      settlements: [
        {
          matchId: MATCH,
          serverId: SETTLED_GUILD,
          winningTeamId: 100,
          voidReason: undefined,
          winnersPool: BucksPoolTotalSchema.parse(10),
          losersPool: BucksPoolTotalSchema.parse(5),
          houseCut: BucksPoolTotalSchema.parse(1),
          bets: [],
        },
      ],
      parlaySettlements: [
        {
          matchId: MATCH,
          serverId: PARLAY_ONLY_GUILD,
          yesResult: true,
          voidReason: undefined,
          legs: [],
          messageRefs: [{ channelId: "c2", messageId: "m2" }],
          bets: [],
        },
      ],
      earnings: [
        {
          serverId: SETTLED_GUILD,
          discordId: "d9",
          alias: "nine",
          reasons: ["played" as const],
          total: 3,
        },
      ],
      dareSettlements: [dareSummary({})],
    };
  }

  test("folding from stored items equals folding live", async () => {
    const source = live();
    const foldedLive = settlementAnnouncementInputs({
      closures: source.closures,
      settlements: source.settlements,
      parlaySettlements: source.parlaySettlements,
      earnings: source.earnings,
    });

    for (const item of settlementAnnouncementItemsOf(source)) {
      expect(
        await recordSettlementAnnouncementItem(prisma, {
          matchId: MATCH,
          item,
        }),
      ).toEqual({ outcome: "applied" });
    }
    const stored = await listSettlementAnnouncementItems(prisma, {
      matchId: MATCH,
    });
    const recovered = recoveredAnnouncementsOf(stored);

    // Identical, not merely overlapping: same guilds, same order, same inputs.
    expect(recovered.settlements).toEqual(foldedLive);
    expect(recovered.dareSummaries).toEqual(source.dareSettlements);
  });

  test("the fold really does carry the two cases a per-item walk would drop", async () => {
    // Guards the test above from passing for the wrong reason. If the fold
    // ever stopped folding these in, the equality could hold while both
    // sides lost them together.
    const source = live();
    const foldedLive = settlementAnnouncementInputs({
      closures: source.closures,
      settlements: source.settlements,
      parlaySettlements: source.parlaySettlements,
      earnings: source.earnings,
    });

    const guilds = foldedLive.map((input) => input.summary.serverId).toSorted();
    expect(guilds).toEqual(
      [SETTLED_GUILD, CLOSURE_ONLY_GUILD, PARLAY_ONLY_GUILD].toSorted(),
    );
  });

  test("a differing payload for a standing item conflicts", async () => {
    const [first] = settlementAnnouncementItemsOf(live());
    if (first === undefined) throw new Error("expected an item");
    await recordSettlementAnnouncementItem(prisma, {
      matchId: MATCH,
      item: first,
    });

    expect(
      await recordSettlementAnnouncementItem(prisma, {
        matchId: MATCH,
        item: { ...first, payload: { ...live().closures[0], houseFill: 99 } },
      }),
    ).toEqual({
      outcome: "conflict",
      reason: "settlement-announcement-differs",
    });
  });
});

describe("a settlement killed before its receipt", () => {
  /**
   * The acceptance criterion. A Dare settles, its instruction commits with it,
   * and the worker dies before anything downstream runs. The takeover cannot
   * re-settle — `settleDaresForMatch` returns a summary only for the
   * transition that committed it — so it must announce from what the dead
   * attempt recorded, and end with the same intents standing.
   */
  test("the takeover mints the same intents from the recorded instructions", async () => {
    await observe(MATCH, "live");
    prepared.kind = "message";
    const settled = dareSummary({});

    // What the dying attempt got as far as: the Dare settled and its
    // instruction committed in the same transaction. Nothing downstream ran.
    await prisma.$transaction(async (tx) => {
      await recordSettlementAnnouncementItem(tx, {
        matchId: MATCH,
        item: {
          family: "dare-summary",
          itemKey: String(settled.dareId),
          payload: settled,
        },
      });
    });
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);

    // The takeover: read what stands, announce from it.
    const recovered = recoveredAnnouncementsOf(
      await listSettlementAnnouncementItems(prisma, { matchId: MATCH }),
    );
    await mintDareSummaryIntentsV2(prisma, {
      matchId: MATCH,
      dareSettlements: recovered.dareSummaries,
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T10:00:00.000Z"),
    });

    const minted = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(minted).toHaveLength(1);
    expect(minted[0]?.intent.kind).toBe("dare-summary");
    // The same Dare, not merely some Dare.
    expect(recovered.dareSummaries).toEqual([settled]);
  });

  test("recovers a settlement recap the same way", async () => {
    // Same shape as the Dare case, for the settlement family: the pool
    // settled, its instruction committed with it, nothing downstream ran.
    await observe(MATCH, "live");
    prepared.kind = "message";
    const settled = {
      matchId: MATCH,
      serverId: GUILD,
      winningTeamId: undefined,
      voidReason: undefined,
      winnersPool: BucksPoolTotalSchema.parse(0),
      losersPool: BucksPoolTotalSchema.parse(0),
      houseCut: BucksPoolTotalSchema.parse(0),
      bets: [],
    };
    await prisma.$transaction(async (tx) => {
      await recordSettlementAnnouncementItem(tx, {
        matchId: MATCH,
        item: {
          family: "settlement",
          itemKey: GUILD,
          payload: settled,
        },
      });
    });

    const recovered = recoveredAnnouncementsOf(
      await listSettlementAnnouncementItems(prisma, { matchId: MATCH }),
    );
    await mintSettlementIntentsV2(prisma, {
      matchId: MATCH,
      announcements: recovered.settlements,
      gameCreation: GAME_CREATED_AT,
      createdAt: new Date("2026-09-19T10:00:00.000Z"),
    });

    const minted = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(minted).toHaveLength(1);
    expect(minted[0]?.intent.kind).toBe("settlement");
    expect(recovered.settlements[0]?.summary).toEqual(settled);
  });

  test("recovers a parlay whose pool settled on an earlier tick", async () => {
    // The parlay family, and deliberately the case with no settlement beside
    // it: the fold is what carries it, so recovery must go through the fold
    // rather than walking the stored items.
    await observe(MATCH, "live");
    prepared.kind = "message";
    const parlay = {
      matchId: MATCH,
      serverId: GUILD,
      yesResult: true,
      voidReason: undefined,
      legs: [],
      messageRefs: [{ channelId: "c9", messageId: "m9" }],
      bets: [],
    };
    await prisma.$transaction(async (tx) => {
      await recordSettlementAnnouncementItem(tx, {
        matchId: MATCH,
        item: { family: "parlay", itemKey: GUILD, payload: parlay },
      });
    });

    const recovered = recoveredAnnouncementsOf(
      await listSettlementAnnouncementItems(prisma, { matchId: MATCH }),
    );

    // One announcement, carrying the parlay, with no settlement of its own.
    expect(recovered.settlements).toHaveLength(1);
    expect(recovered.settlements[0]?.parlay).toEqual(parlay);
  });

  test("an instruction cannot survive a settlement that rolled back", async () => {
    // The other half of "inside the transaction": if the settling transaction
    // fails, its instruction must go with it. An instruction for a Dare that
    // never settled would announce a result nobody reached.
    const settled = dareSummary({ dareId: 4242 });

    await expect(
      prisma.$transaction(async (tx) => {
        await recordSettlementAnnouncementItem(tx, {
          matchId: MATCH,
          item: {
            family: "dare-summary",
            itemKey: String(settled.dareId),
            payload: settled,
          },
        });
        throw new Error("the settling transaction failed after recording");
      }),
    ).rejects.toThrow("the settling transaction failed");

    expect(
      await listSettlementAnnouncementItems(prisma, { matchId: MATCH }),
    ).toEqual([]);
  });
});
