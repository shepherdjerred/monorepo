import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type * as DatabaseModule from "#src/database/index.ts";
import type { SettlementAnnouncementSink } from "#src/betting/notify/announcement-sink.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

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

type DriveSettlement = (sink: SettlementAnnouncementSink) => Promise<void>;

const settlement = vi.hoisted((): { drive: DriveSettlement | undefined } => ({
  drive: undefined,
}));

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2MatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: {
        info: { gameCreation: Date.parse("2026-09-18T09:00:00.000Z") },
      },
      trackedPlayers: [],
      allPlayerConfigs: [],
    }),
}));

vi.mock("#src/betting/dares/evaluation/dare-postmatch-timeline-v2.ts", () => ({
  settleBucksWithDareTimelineV2: async (input: {
    announcementSink: SettlementAnnouncementSink;
  }) => {
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

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.matchSettlementAnnouncement.deleteMany({});
  await prisma.matchObservation.deleteMany({});
  for (const matchId of [
    WRITE_FAILS,
    WRITE_CONFLICTS,
    CONFLICTS_INSIDE_A_DARE_BATCH,
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
