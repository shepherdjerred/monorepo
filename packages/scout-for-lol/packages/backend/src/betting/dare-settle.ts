import * as Sentry from "@sentry/bun";
import { resolveQueueTypeFromGame, type RawMatch } from "@scout-for-lol/data";
import { z } from "zod";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import {
  DARE_ELIGIBLE_QUEUES,
  DARE_EVALUATOR_VERSION,
  evaluateDareGame,
  evaluateDareTree,
  parseLeafHits,
} from "#src/betting/dare-criteria.ts";
import {
  dareMoneyFactsInTransaction,
  payDareTargetsInTransaction,
  refundDareContributionsInTransaction,
} from "#src/betting/dare-ledger.ts";
import { BucksStorageOverflowError } from "#src/betting/ledger.ts";
import {
  baseSummary,
  dareRefundView,
  parseDare,
  voidDareWithFullRefund,
  DarePartialSettlementError,
  type ActiveDareRow,
  type DareSettlementSummary,
  type ParsedDare,
} from "#src/betting/dare-settle-shared.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  DARE_SETTLE_ATTEMPTS,
  withBoundedRetry,
} from "#src/betting/dare-settle-retry.ts";
import {
  bettingDareGamesCapturedTotal,
  bettingDareSettlementsTotal,
  bettingDaresTotal,
} from "#src/metrics/betting.ts";

const logger = createLogger("betting-dare-settle");

/**
 * Match-driven dare capture and settlement.
 *
 * Capture and evaluation share ONE transaction behind the dare-row claim: a
 * game row can never commit without the achievement check running, so an
 * early settlement cannot be lost to a crash, and contributions, sweeps, and
 * settles all serialize on the same row. The `(dareId, matchId)` unique key
 * makes ingest replays no-ops.
 *
 * The pre-transaction dare row drives eligibility and discovery only — every
 * money fact (the pot and the contribution set) is re-derived inside the
 * transaction after the claim, because a contribution can commit between the
 * discovery read and the claim.
 */

const DareQueueSchema = z.enum(DARE_ELIGIBLE_QUEUES);

async function captureAndSettleDare(
  tx: Db,
  input: {
    dare: ParsedDare;
    matchData: RawMatch;
    queueType: string;
    leafHits: boolean[];
    snapshot: unknown;
    now: Date;
  },
): Promise<DareSettlementSummary | undefined> {
  const { dare, matchData, now } = input;
  const matchId = matchData.metadata.matchId;
  // Guarded first statement: the dare-row claim serializes capture against
  // contributions, sweeps, and any concurrent settlement of the same dare.
  const claim = await tx.bucksDare.updateMany({
    where: { id: dare.row.id, dareState: "active" },
    data: { updatedAt: now },
  });
  if (claim.count !== 1) return undefined;
  // Money facts re-read AFTER the claim — the discovery row is stale the
  // moment a contribution commits behind it, and the conservation asserts
  // compare against the fresh contribution rows.
  const facts = await dareMoneyFactsInTransaction(tx, {
    ...dare.facts,
    matchId,
  });

  // Idempotent capture: an ingest replay hits the (dareId, matchId) unique
  // key, inserts nothing, and must not re-run settlement.
  const captured = await tx.bucksDareGame.createMany({
    data: [
      {
        dareId: dare.row.id,
        matchId,
        gameStartAt: new Date(matchData.info.gameStartTimestamp),
        gameEndAt: new Date(matchData.info.gameEndTimestamp),
        queueType: input.queueType,
        leafHits: JSON.stringify(input.leafHits),
        snapshot: JSON.stringify(input.snapshot),
      },
    ],
    skipDuplicates: true,
  });
  if (captured.count !== 1) return undefined;

  const rows = await tx.bucksDareGame.findMany({
    where: { dareId: dare.row.id },
    orderBy: { id: "asc" },
    select: { leafHits: true },
  });
  const tree = evaluateDareTree(
    dare.conditions,
    rows.map((row) => ({ leafHits: parseLeafHits(row.leafHits) })),
  );

  if (tree.achieved) {
    await tx.bucksDare.updateMany({
      where: { id: dare.row.id, dareState: "active" },
      data: { dareState: "achieved", settledAt: now },
    });
    const payees = dare.row.targets.map((target) => {
      if (target.bucksAccountId === null || target.acceptedAt === null) {
        throw new Error(
          `Active dare ${dare.row.id.toString()} has an unaccepted target ${target.id.toString()}`,
        );
      }
      return {
        id: target.id,
        discordId: target.discordId,
        alias: target.alias,
        bucksAccountId: target.bucksAccountId,
      };
    });
    const { payouts } = await payDareTargetsInTransaction(tx, {
      facts,
      targets: payees,
    });
    const summary = baseSummary(dare, "achieved", matchId);
    summary.potTotal = facts.potTotal;
    summary.payouts = payouts;
    summary.leafCounts = tree.leafCounts;
    return summary;
  }

  if (dare.horizonKind === "next_game") {
    // The one bound game evaluated false, so the dare is settled unachieved
    // in the same transaction — a next-game dare never waits for its clock.
    //
    // "Next game" means the first eligible game INGESTED, not the first one
    // played: when two eligible games finish close together and the
    // later-started one ingests first, that one binds the dare. Documented
    // accepted tradeoff from the plan — ingest order tracks play order
    // closely at these stakes, and re-presenting matches in play order would
    // need a per-dare match queue the feature deliberately does not have.
    await tx.bucksDare.updateMany({
      where: { id: dare.row.id, dareState: "active" },
      data: { dareState: "unachieved", settledAt: now },
    });
    const refunds = await refundDareContributionsInTransaction(tx, {
      facts,
      resolution: "unachieved",
      withCut: true,
    });
    const summary = baseSummary(dare, "unachieved", matchId);
    summary.potTotal = facts.potTotal;
    summary.refunds = refunds;
    summary.leafCounts = tree.leafCounts;
    return summary;
  }

  const summary = baseSummary(dare, "captured", matchId);
  summary.potTotal = facts.potTotal;
  summary.leafCounts = tree.leafCounts;
  return summary;
}

function observeDareSettlement(summary: DareSettlementSummary): void {
  // A voided dare was already fully observed inside voidDareWithFullRefund,
  // and no game was captured for it.
  if (summary.resolution === "voided") {
    return;
  }
  bettingDareGamesCapturedTotal.inc();
  if (summary.resolution === "captured") {
    logger.info(
      `🎯 Captured ${summary.matchId ?? "a game"} against dare ${summary.dareId.toString()}`,
    );
    return;
  }
  bettingDaresTotal.inc({ result: summary.resolution });
  bettingDareSettlementsTotal.inc({ outcome: summary.resolution });
  logBucksTransition({
    event:
      summary.resolution === "achieved"
        ? "bucks.dare.achieved"
        : "bucks.dare.unachieved",
    serverId: summary.serverId,
    dareId: summary.dareId,
    ...(summary.matchId === undefined ? {} : { matchId: summary.matchId }),
    payout: summary.potTotal,
    fromState: "active",
    toState: summary.resolution,
    surface: "postmatch",
  });
}

/**
 * The one call the post-match pipeline makes into dares.
 *
 * Deliberately NOT "never throws" the way its sibling markets are — a dare's
 * capture is bound to this one specific match, and the postmatch cursor
 * never re-presents a match once it advances past it. Swallowing a genuine
 * (non-transient-recovered) failure here would silently and permanently
 * lose that dare's one chance to capture this game, which can later
 * mis-settle an actually-achieved dare as unachieved with a house cut.
 *
 * So: discovery and each dare get a short bounded retry
 * ({@link DARE_SETTLE_ATTEMPTS}) to absorb a transient blip, and if that is
 * exhausted, the error is logged, paged to Sentry, and RETHROWN. The caller
 * (`processMatchAndUpdatePlayers`) does not advance the match-history cursor
 * on a thrown error — this is the same "NOT advancing cursor; will retry
 * next poll" pattern already used for the S3 ingest gate. Every sibling
 * write this function's caller already ran (outcome/parlay settlement,
 * weekly capture, earnings) is independently idempotent on state, so
 * retrying the whole match is safe: they simply no-op on the replay, and
 * only the dares still `active` get evaluated again.
 */
export async function settleDaresForMatch(
  matchData: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareSettlementSummary[]> {
  const matchId = matchData.metadata.matchId;
  const queue = DareQueueSchema.safeParse(
    resolveQueueTypeFromGame(
      matchData.info.queueId,
      matchData.info.gameMode,
      matchData.info.gameType,
    ),
  );
  if (!queue.success) return [];
  // A remake (or unreadable result) is never captured and never consumes a
  // next-game bind — the same classification gate every other market uses.
  if (classifyMatchForBetting(matchData).kind !== "decided") return [];

  const gameStartAt = new Date(matchData.info.gameStartTimestamp);
  const gameEndAt = new Date(matchData.info.gameEndTimestamp);
  const dares = await (async () => {
    try {
      return await withBoundedRetry(
        () =>
          prismaClient.bucksDare.findMany({
            where: {
              dareState: "active",
              OR: [
                // The SQL image of the per-dare clock gates in
                // settleOneDareForMatch: activated before the game started,
                // and the game ended by the stored deadline (a next_game
                // dare stores its timeout in windowEndsAt, so one predicate
                // serves both horizons).
                {
                  activatedAt: { lt: gameStartAt },
                  windowEndsAt: { gte: gameEndAt },
                },
                // An active dare with a missing clock is a broken contract.
                // Kept in the batch so the loud per-dare throw below
                // surfaces it — a bare SQL filter would hide the bug
                // silently.
                { activatedAt: null },
                { windowEndsAt: null },
              ],
            },
            // Deterministic processing order — Postgres does not guarantee
            // one without an explicit ORDER BY, and a stable order matters
            // for `DarePartialSettlementError` reasoning about "everything
            // before the failure already committed".
            orderBy: { id: "asc" },
            include: { targets: { orderBy: { id: "asc" } } },
          }),
        DARE_SETTLE_ATTEMPTS,
      );
    } catch (error) {
      logger.error(
        `Could not load active dares for ${matchId} after ${DARE_SETTLE_ATTEMPTS.toString()} attempts:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-dare-settle-load", matchId },
      });
      throw error;
    }
  })();

  const summaries: DareSettlementSummary[] = [];
  let firstFailure: unknown;
  for (const row of dares) {
    try {
      const summary = await settleOneDareForMatchWithRetry(row, {
        matchData,
        queueType: queue.data,
        prismaClient,
        now,
      });
      if (summary !== undefined) {
        summaries.push(summary);
        observeDareSettlement(summary);
      }
    } catch (error) {
      // Every retry attempt is exhausted for this ONE dare. Logged and
      // paged for visibility. Deliberately NOT rethrown here — keep
      // processing the rest of the batch (the original per-dare isolation:
      // one bad dare must not cost its neighbours their chance at this same
      // match) and remember only the first failure to report once the loop
      // finishes, WITH every summary already collected. Throwing
      // immediately here would discard those already-committed summaries —
      // exactly the loss this function's doc comment exists to prevent.
      logger.error(
        `Could not settle dare ${row.id.toString()} for ${matchId} after ${DARE_SETTLE_ATTEMPTS.toString()} attempts:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-dare-settle",
          matchId,
          dareId: row.id.toString(),
        },
      });
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) {
    throw new DarePartialSettlementError(summaries, firstFailure);
  }
  return summaries;
}

/**
 * Wraps {@link settleOneDareForMatch} with a short bounded retry.
 *
 * `captureAndSettleDare`'s transaction is atomic — Postgres either commits
 * the whole thing or none of it — so a retry after a genuine rollback (a
 * momentary connection blip, a serialization conflict) simply re-runs the
 * same guarded claim and is safe. The one theoretical exception is a commit
 * that succeeded but whose acknowledgement was lost before this function saw
 * it; a retry there would hit `BucksDareGame`'s unique `(dareId, matchId)`
 * constraint and fail like any other error, which is no worse than today's
 * un-retried behavior and is astronomically rarer than the transient
 * failures this guards against.
 */
async function settleOneDareForMatchWithRetry(
  row: ActiveDareRow,
  input: {
    matchData: RawMatch;
    queueType: string;
    prismaClient: ExtendedPrismaClient;
    now: Date;
  },
): Promise<DareSettlementSummary | undefined> {
  return withBoundedRetry(
    () => settleOneDareForMatch(row, input),
    DARE_SETTLE_ATTEMPTS,
  );
}

async function settleOneDareForMatch(
  row: ActiveDareRow,
  input: {
    matchData: RawMatch;
    queueType: string;
    prismaClient: ExtendedPrismaClient;
    now: Date;
  },
): Promise<DareSettlementSummary | undefined> {
  const { matchData, prismaClient, now } = input;
  const matchId = matchData.metadata.matchId;
  // Evaluator gate FIRST, before any strict conditions parse: voiding is a
  // refund path and must work even when the stored blob no longer parses.
  if (row.evaluatorVersion !== DARE_EVALUATOR_VERSION) {
    return await voidDareWithFullRefund(
      dareRefundView(row),
      prismaClient,
      now,
      {
        voidReason: "unknown_evaluator",
        surface: "postmatch",
      },
    );
  }
  if (row.activatedAt === null || row.windowEndsAt === null) {
    throw new Error(
      `Active dare ${row.id.toString()} is missing its activation clock`,
    );
  }
  const gameStartAt = new Date(matchData.info.gameStartTimestamp);
  const gameEndAt = new Date(matchData.info.gameEndTimestamp);
  // Eligibility is "played inside the window": started after activation and
  // ended by the deadline. Ingestion time is irrelevant — the sweep's grace
  // period exists precisely so a late ingest still lands here. (Discovery
  // already filtered on these clocks in SQL; re-checked cheaply here so a
  // direct caller gets identical behavior.)
  if (gameStartAt.getTime() <= row.activatedAt.getTime()) {
    return undefined;
  }
  if (gameEndAt.getTime() > row.windowEndsAt.getTime()) {
    return undefined;
  }

  const dare = parseDare(row, matchId);
  const evaluation = evaluateDareGame(dare.conditions, dare.targets, matchData);
  if (evaluation === undefined) {
    return undefined;
  }

  try {
    return await prismaClient.$transaction((tx) =>
      captureAndSettleDare(tx, {
        dare,
        matchData,
        queueType: input.queueType,
        leafHits: evaluation.leafHits,
        snapshot: evaluation.snapshot,
        now,
      }),
    );
  } catch (error) {
    if (error instanceof BucksStorageOverflowError) {
      // A payout the wallet cannot hold rolled the capture back. Stranding
      // the dare would mis-settle it later as unachieved WITH a cut, so it
      // is voided instead: full refunds, no cut, fresh transaction
      // (weekly-parlay "storage_overflow" precedent).
      return await voidDareWithFullRefund(
        dareRefundView(row, matchId),
        prismaClient,
        now,
        { voidReason: "storage_overflow", surface: "postmatch" },
      );
    }
    throw error;
  }
}
