import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { SettlementAnnouncementSink } from "#src/betting/notify/announcement-sink.ts";
import type * as MatchIntentsModule from "#src/temporal/v2/notification/match-intents.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";

/**
 * What the settlement Activity does when its checkpoint cannot be written.
 *
 * The other half of this guarantee lives in `settle.integration.test.ts`,
 * which proves the betting slice lets a `SettlementCheckpointError` escape
 * instead of logging it as one guild's misfortune. This half proves what the
 * Activity then does with it: no settlement receipt, and a conflict surfaced
 * as non-retryable so it pages instead of looping.
 *
 * The two meet at `settleBucksWithDareTimelineV2`, which is replaced here — a
 * collaborator of the code under test, not the code under test. It is handed
 * the REAL sink the Activity built and drives it exactly as settlement does,
 * so the failure under test is the one the real sink raises. Every durable
 * write — the observation, the announcement rows, the receipt, the advisory
 * fence — runs against Postgres.
 */

const { prisma } = createTestDatabase("scout-v2-settlement-checkpoint");

const WRITE_FAILS = RiotMatchIdSchema.parse("NA1_9501");
const WRITE_CONFLICTS = RiotMatchIdSchema.parse("NA1_9502");
const CONFLICTS_INSIDE_A_DARE_BATCH = RiotMatchIdSchema.parse("NA1_9503");
const PARTLY_SETTLED = RiotMatchIdSchema.parse("NA1_9504");
const BACKFILLED = RiotMatchIdSchema.parse("NA1_9505");

type DriveSettlement = (sink: SettlementAnnouncementSink) => Promise<void>;

const settlement = vi.hoisted(
  (): { drive: DriveSettlement | undefined; entered: number } => ({
    drive: undefined,
    entered: 0,
  }),
);

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2ObservedMatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchDataSource: "RIOT",
      matchData: {
        info: { gameCreation: Date.parse("2026-09-18T09:00:00.000Z") },
      },
      trackedPlayers: [],
    }),
}));

// Only the settlement minter is replaced, and only to see WHICH instructions
// reach it; everything else in the module — the delivery gate this Activity
// reads, the item builders — stays real.
const minted = vi.hoisted((): { guilds: string[] } => ({ guilds: [] }));

vi.mock("#src/temporal/v2/notification/match-intents.ts", async () => {
  const actual = await vi.importActual<typeof MatchIntentsModule>(
    "#src/temporal/v2/notification/match-intents.ts",
  );
  return {
    ...actual,
    mintSettlementIntentsV2: (
      db: Parameters<typeof actual.mintSettlementIntentsV2>[0],
      args: Parameters<typeof actual.mintSettlementIntentsV2>[1],
    ) => {
      minted.guilds.push(
        ...(args.announcements ?? []).map(
          (announcement) => announcement.summary.serverId,
        ),
      );
      return actual.mintSettlementIntentsV2(db, args);
    },
  };
});

vi.mock("#src/betting/dares/evaluation/dare-postmatch-timeline-v2.ts", () => ({
  settleBucksWithDareTimelineV2: async (input: {
    announcementSink: SettlementAnnouncementSink;
  }) => {
    settlement.entered += 1;
    if (settlement.drive === undefined) {
      throw new Error("the test did not say how settlement should behave");
    }
    await settlement.drive(input.announcementSink);
    // Reached only if the sink did NOT refuse. An empty settlement is the
    // honest stand-in for that: nothing to mint, and the Activity goes on to
    // record its receipt — which is exactly the outcome these tests must be
    // able to observe, so a sink that swallowed its failure fails them.
    return {
      bucks: {
        closures: [],
        settlements: [],
        parlaySettlements: [],
        dareSettlements: [],
        earnings: [],
      },
      prefetchedTimeline: undefined,
      prefetchedPlayers: undefined,
      prefetchedRankChanges: undefined,
    };
  },
}));

const { settleMatchMarketsV2 } =
  await import("#src/temporal/v2/match-effects.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");
const { readMatchReceiptEvidenceV2 } =
  await import("#src/temporal/v2/match-commits.ts");
const { MATCH_RECEIPT_KINDS } =
  await import("#src/durable/match/receipt-evidence.ts");
const { recordSettlementAnnouncementItem } =
  await import("#src/database/durable/settlement-announcement-repository.ts");
const { DarePartialSettlementError } =
  await import("#src/betting/dares/settlement/dare-settle-shared.ts");
const { settlementEvidenceCodec } =
  await import("#src/durable/match/receipt-evidence.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.matchSettlementAnnouncement.deleteMany({});
  await prisma.matchObservation.deleteMany({});
  await observeMatch(prisma, {
    matchId: BACKFILLED,
    platformRoute: "NA1",
    policy: "FULL",
    // Owed no public delivery, which is the whole point of this case.
    deliveryMode: "silent-backfill",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-18T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-18T09:40:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
  for (const matchId of [
    WRITE_FAILS,
    WRITE_CONFLICTS,
    CONFLICTS_INSIDE_A_DARE_BATCH,
    PARTLY_SETTLED,
  ]) {
    // A live match, so the Activity builds the CHECKPOINTING sink rather than
    // the silent one. A backfill records nothing and has nothing to lose.
    await observeMatch(prisma, {
      matchId,
      platformRoute: "NA1",
      policy: "FULL",
      deliveryMode: "live",
      owner: { kind: "temporal-v2" },
      promotion: null,
      gameCreatedAt: IsoInstantSchema.parse("2026-09-18T09:00:00.000Z"),
      observedAt: IsoInstantSchema.parse("2026-09-18T09:40:00.000Z"),
      artifacts: { match: null, timeline: null },
    });
  }
});

async function standingSettlementReceipt(
  matchId: RiotMatchId,
): Promise<unknown> {
  return await readMatchReceiptEvidenceV2(
    matchId,
    MATCH_RECEIPT_KINDS.settlement,
  );
}

/** One guild's settled pool, in the shape a checkpoint stores. */
function settlementPayload(
  serverId: string,
  betId: number,
  matchId: string = PARTLY_SETTLED,
): unknown {
  return {
    matchId,
    serverId,
    winningTeamId: 100,
    winnersPool: 100,
    losersPool: 100,
    houseCut: 10,
    bets: [
      {
        betId,
        bucksAccountId: betId,
        discordId: "100000000000000001",
        isHouse: false,
        predictedTeamId: 100,
        submittedStake: 50,
        matchedStake: 50,
        unmatchedStake: 0,
        grossPayout: 100,
        houseCut: 10,
        payout: 90,
        winnings: 40,
        won: true,
        refunded: false,
        subjectPuuid: "p".repeat(78),
      },
    ],
  };
}

describe("a settlement resuming a match another attempt settled part of", () => {
  test("re-enters settlement instead of reading a checkpoint as completion", async () => {
    // The regression. An attempt whose first pool checkpointed and whose
    // second failed leaves ONE row. Reading "a row exists" as "settlement
    // completed" returned already-applied, and the match was retired with its
    // second pool closed and its bettors never paid.
    await recordSettlementAnnouncementItem(prisma, {
      matchId: PARTLY_SETTLED,
      item: {
        family: "settlement",
        itemKey: "guild-1",
        payload: settlementPayload("guild-1", 101),
      },
    });
    settlement.entered = 0;
    settlement.drive = async (sink) => {
      await sink.recordAnnouncementItem(prisma, {
        family: "settlement",
        itemKey: "guild-2",
        payload: settlementPayload("guild-2", 202),
      });
    };

    minted.guilds.length = 0;

    await settleMatchMarketsV2({ riotMatchId: PARTLY_SETTLED });

    // Settlement RAN, which is what pays the pool the dead attempt missed.
    expect(settlement.entered).toBe(1);
    // And the mint is driven by BOTH attempts' instructions: the dead
    // attempt's recap exists only as its checkpoint, and nothing else can
    // reconstruct it.
    expect(minted.guilds.toSorted()).toEqual(["guild-1", "guild-2"]);
  });

  test("attests what the match settled, not what the last attempt returned", async () => {
    // Settlement's steps are one-shot, so a resumption legitimately returns
    // little or nothing. A receipt built from that alone would record an
    // empty settlement for a match whose bets are all resolved — a durable
    // record saying the opposite of what happened.
    await recordSettlementAnnouncementItem(prisma, {
      matchId: PARTLY_SETTLED,
      item: {
        family: "settlement",
        itemKey: "guild-1",
        payload: settlementPayload("guild-1", 101),
      },
    });
    settlement.drive = async (sink) => {
      await sink.recordAnnouncementItem(prisma, {
        family: "settlement",
        itemKey: "guild-2",
        payload: settlementPayload("guild-2", 202),
      });
    };

    await settleMatchMarketsV2({ riotMatchId: PARTLY_SETTLED });

    const evidence = await standingSettlementReceipt(PARTLY_SETTLED);
    expect(evidence).not.toBeNull();
    const parsed = settlementEvidenceCodec.parse(evidence);
    expect(parsed.settledBetIds.toSorted((a, b) => a - b)).toEqual([101, 202]);
  });
});

test("a backfilled match still records what its settlement produced", async () => {
  // Announcement eligibility and recovery evidence are different questions,
  // and the sink used to fuse them: a silent match recorded nothing, so a
  // death after a pool committed left the retry with state-gated nothing and
  // no standing instruction, and the receipt then attested a settlement with
  // no ledger identities although the money had moved.
  //
  // The money is not silent. Only the announcing is, and the mint reads the
  // same committed mode to decide that.
  settlement.drive = async (sink) => {
    await sink.recordAnnouncementItem(prisma, {
      family: "settlement",
      itemKey: "guild-1",
      payload: settlementPayload("guild-1", 303, BACKFILLED),
    });
  };

  await settleMatchMarketsV2({ riotMatchId: BACKFILLED });

  const stored = await prisma.matchSettlementAnnouncement.findMany({
    where: { riotMatchId: BACKFILLED },
  });
  expect(stored).toHaveLength(1);
});

describe("a settlement whose checkpoint cannot be written", () => {
  test("records no settlement receipt", async () => {
    // The loss this closes: the receipt IS what a retry reads to decide the
    // effect is done. Written over a settlement that rolled back, it retires
    // the match permanently with its bettors unpaid.
    settlement.drive = async (sink) => {
      await sink.recordAnnouncementItem(
        // A handle that cannot write: the checkpoint fails for real rather
        // than by a thrown stub, so the Activity sees what production sees.
        prisma.$extends({
          query: {
            matchSettlementAnnouncement: {
              createMany: () => {
                throw new Error("connection reset writing the checkpoint");
              },
            },
          },
        }),
        { family: "settlement", itemKey: "guild-1", payload: { net: 10 } },
      );
    };

    await expect(
      settleMatchMarketsV2({ riotMatchId: WRITE_FAILS }),
    ).rejects.toThrow();

    expect(await standingSettlementReceipt(WRITE_FAILS)).toBeNull();
  });

  test("surfaces a conflicting checkpoint as non-retryable", async () => {
    // Two producers disagreeing about what ONE settlement produced. No retry
    // resolves that, and the standing row is the only record of what the
    // first producer did, so the Activity pages instead of looping or
    // overwriting.
    //
    // Staged as the race it actually is. The Activity read-gates on standing
    // instructions BEFORE settling, so a row that already existed would have
    // sent this run down the recovery path and settlement would never have
    // run. The conflict is reachable only when the other producer lands
    // WHILE this settlement is in flight, so that is what this does.
    settlement.drive = async (sink) => {
      await recordSettlementAnnouncementItem(prisma, {
        matchId: WRITE_CONFLICTS,
        item: {
          family: "settlement",
          itemKey: "guild-1",
          payload: { net: 10 },
        },
      });
      await sink.recordAnnouncementItem(prisma, {
        family: "settlement",
        itemKey: "guild-1",
        payload: { net: 99 },
      });
    };

    const settled = await settleMatchMarketsV2({
      riotMatchId: WRITE_CONFLICTS,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(settled).toBeInstanceOf(ApplicationFailure);
    expect(settled).toMatchObject({
      type: "DurableCommitConflict",
      nonRetryable: true,
    });
    expect(await standingSettlementReceipt(WRITE_CONFLICTS)).toBeNull();
    // The first producer's record is untouched.
    const stored = await prisma.matchSettlementAnnouncement.findMany({
      where: { riotMatchId: WRITE_CONFLICTS },
    });
    expect(stored).toHaveLength(1);
  });

  test("sees a conflict reported inside the Dare batch's own error", async () => {
    // Not every handler on the way up rethrows the original. The Dare batch
    // collects the first per-dare failure and reports it as a
    // `DarePartialSettlementError`, so the summaries that DID commit are not
    // discarded — correct, and it must stay. A boundary matching only the
    // outermost error would miss the conflict inside and let Temporal retry a
    // failure no retry resolves.
    settlement.drive = async (sink) => {
      await recordSettlementAnnouncementItem(prisma, {
        matchId: CONFLICTS_INSIDE_A_DARE_BATCH,
        item: { family: "dare-summary", itemKey: "7", payload: { won: true } },
      });
      try {
        await sink.recordAnnouncementItem(prisma, {
          family: "dare-summary",
          itemKey: "7",
          payload: { won: false },
        });
      } catch (error) {
        throw new DarePartialSettlementError([], error);
      }
    };

    const settled = await settleMatchMarketsV2({
      riotMatchId: CONFLICTS_INSIDE_A_DARE_BATCH,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(settled).toBeInstanceOf(ApplicationFailure);
    expect(settled).toMatchObject({
      type: "DurableCommitConflict",
      nonRetryable: true,
    });
    expect(
      await standingSettlementReceipt(CONFLICTS_INSIDE_A_DARE_BATCH),
    ).toBeNull();
  });
});
