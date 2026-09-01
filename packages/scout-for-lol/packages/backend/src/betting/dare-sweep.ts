import * as Sentry from "@sentry/bun";
import { DARE_WINDOW_INGESTION_GRACE_MS } from "#src/betting/constants.ts";
import { DARE_EVALUATOR_VERSION } from "#src/betting/dare-criteria.ts";
import {
  dareMoneyFactsInTransaction,
  refundDareContributionsInTransaction,
} from "#src/betting/dare-ledger.ts";
import {
  baseSummary,
  dareRefundView,
  voidDareWithFullRefund,
  type ActiveDareRow,
  type DareRefundView,
  type DareSettlementSummary,
} from "#src/betting/dare-settle-shared.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  bettingDareSettlementsTotal,
  bettingDaresTotal,
} from "#src/metrics/betting.ts";

const logger = createLogger("betting-dare-sweep");

/**
 * The dare clocks. No timers exist anywhere: the maintenance activities call
 * these opportunistically (`checkPreMatch` for the proposal TTL and accept
 * window, `runPostMatchMaintenance` for ended windows), each record is
 * claimed with a guarded first statement, and one bad record never blocks
 * the rest of its batch. Like every refund path these run regardless of
 * feature flags — a revoked flag must never strand escrowed contributions.
 */

const DARE_SWEEP_INCLUDE = {
  targets: { orderBy: { id: "asc" as const } },
};

/**
 * Claim one dare row into a terminal state and refund its contributors in
 * the same transaction. Returns undefined when another resolution won the
 * claim (a racing accept, decline, or capture-settle). The money facts are
 * re-derived after the claim — the discovery row is stale the moment a
 * contribution commits behind it.
 */
async function claimAndRefundDare(
  prismaClient: ExtendedPrismaClient,
  dare: DareRefundView,
  input: {
    fromState: "pending_accept" | "active";
    toState: "expired" | "unachieved";
    withCut: boolean;
    now: Date;
  },
) {
  return await prismaClient.$transaction(async (tx) => {
    // Guarded first statement: exactly one sweep pass wins, and any racing
    // accept, decline, contribution, or capture serializes against it.
    const claim = await tx.bucksDare.updateMany({
      where: { id: dare.row.id, dareState: input.fromState },
      data: { dareState: input.toState, settledAt: input.now },
    });
    if (claim.count !== 1) {
      return;
    }
    const facts = await dareMoneyFactsInTransaction(tx, dare.facts);
    const refunds = await refundDareContributionsInTransaction(tx, {
      facts,
      resolution: input.toState,
      withCut: input.withCut,
    });
    return { refunds, potTotal: facts.potTotal };
  });
}

/**
 * A `proposed` dare nobody confirmed inside its TTL holds no money and is
 * simply marked `abandoned`.
 */
export async function abandonExpiredDareProposals(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareSettlementSummary[]> {
  const summaries: DareSettlementSummary[] = [];
  try {
    const stale = await prismaClient.bucksDare.findMany({
      where: { dareState: "proposed", proposalExpiresAt: { lt: now } },
      include: DARE_SWEEP_INCLUDE,
    });
    for (const row of stale) {
      try {
        const claim = await prismaClient.bucksDare.updateMany({
          where: { id: row.id, dareState: "proposed" },
          data: { dareState: "abandoned" },
        });
        if (claim.count !== 1) continue;
        bettingDaresTotal.inc({ result: "abandoned" });
        logBucksTransition({
          event: "bucks.dare.abandoned",
          serverId: row.serverId,
          dareId: row.id,
          fromState: "proposed",
          toState: "abandoned",
          surface: "sweep",
        });
        summaries.push(baseSummary(dareRefundView(row), "abandoned"));
      } catch (error) {
        logger.error(
          `Could not abandon stale dare proposal ${row.id.toString()}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: {
            source: "betting-dare-sweep-abandon",
            dareId: row.id.toString(),
          },
        });
      }
    }
  } catch (error) {
    logger.error("Could not load stale dare proposals:", error);
    Sentry.captureException(error, {
      tags: { source: "betting-dare-sweep-abandon-load" },
    });
  }
  return summaries;
}

/**
 * A `pending_accept` dare whose 24h accept window lapsed is the public
 * chicken outcome: cancel and refund every contributor in full, no cut.
 */
export async function expireDareAcceptWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareSettlementSummary[]> {
  const summaries: DareSettlementSummary[] = [];
  try {
    const lapsed = await prismaClient.bucksDare.findMany({
      where: { dareState: "pending_accept", acceptDeadline: { lt: now } },
      include: DARE_SWEEP_INCLUDE,
    });
    for (const row of lapsed) {
      try {
        const dare = dareRefundView(row);
        const outcome = await claimAndRefundDare(prismaClient, dare, {
          fromState: "pending_accept",
          toState: "expired",
          withCut: false,
          now,
        });
        if (outcome === undefined) continue;
        bettingDaresTotal.inc({ result: "expired" });
        bettingDareSettlementsTotal.inc({ outcome: "expired" });
        logBucksTransition({
          event: "bucks.dare.expired",
          serverId: row.serverId,
          dareId: row.id,
          payout: outcome.potTotal,
          fromState: "pending_accept",
          toState: "expired",
          surface: "sweep",
        });
        const summary = baseSummary(dare, "expired");
        summary.potTotal = outcome.potTotal;
        summary.refunds = outcome.refunds;
        summaries.push(summary);
      } catch (error) {
        logger.error(
          `Could not expire dare accept window ${row.id.toString()}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: {
            source: "betting-dare-sweep-expire",
            dareId: row.id.toString(),
          },
        });
      }
    }
  } catch (error) {
    logger.error("Could not load lapsed dare accept windows:", error);
    Sentry.captureException(error, {
      tags: { source: "betting-dare-sweep-expire-load" },
    });
  }
  return summaries;
}

async function settleOneEndedWindow(
  row: ActiveDareRow,
  prismaClient: ExtendedPrismaClient,
  now: Date,
): Promise<DareSettlementSummary | undefined> {
  // No strict conditions parse anywhere on this path: both the void and the
  // unachieved refund must run even when the stored blob no longer parses
  // (refunds are never blocked; the summary text is best-effort display).
  const dare = dareRefundView(row);
  // Evaluator gate FIRST — an unimplemented stored version is voided with a
  // full refund and needs nothing but the row.
  if (row.evaluatorVersion !== DARE_EVALUATOR_VERSION) {
    return await voidDareWithFullRefund(dare, prismaClient, now, {
      voidReason: "unknown_evaluator",
      surface: "sweep",
    });
  }
  const outcome = await claimAndRefundDare(prismaClient, dare, {
    fromState: "active",
    toState: "unachieved",
    withCut: true,
    now,
  });
  if (outcome === undefined) {
    return undefined;
  }
  bettingDaresTotal.inc({ result: "unachieved" });
  bettingDareSettlementsTotal.inc({ outcome: "unachieved" });
  logBucksTransition({
    event: "bucks.dare.unachieved",
    serverId: dare.row.serverId,
    dareId: dare.row.id,
    payout: outcome.potTotal,
    fromState: "active",
    toState: "unachieved",
    surface: "sweep",
  });
  const summary = baseSummary(dare, "unachieved");
  summary.potTotal = outcome.potTotal;
  summary.refunds = outcome.refunds;
  return summary;
}

/**
 * An `active` dare whose window (or next-game timeout) ended without the
 * tree turning true settles unachieved: each contributor gets their total
 * back minus the cancellation house cut. The ingestion grace keeps a game
 * that ENDED inside the window from being refunded away while Match-V5 is
 * still minutes from ingesting it.
 */
export async function settleEndedDareWindows(
  prismaClient: ExtendedPrismaClient = prisma,
  now: Date = new Date(),
): Promise<DareSettlementSummary[]> {
  const summaries: DareSettlementSummary[] = [];
  const cutoff = new Date(now.getTime() - DARE_WINDOW_INGESTION_GRACE_MS);
  try {
    const ended = await prismaClient.bucksDare.findMany({
      where: { dareState: "active", windowEndsAt: { lt: cutoff } },
      include: DARE_SWEEP_INCLUDE,
    });
    for (const row of ended) {
      try {
        const summary = await settleOneEndedWindow(row, prismaClient, now);
        if (summary !== undefined) summaries.push(summary);
      } catch (error) {
        logger.error(
          `Could not settle ended dare window ${row.id.toString()}:`,
          error,
        );
        Sentry.captureException(error, {
          tags: {
            source: "betting-dare-sweep-window",
            dareId: row.id.toString(),
          },
        });
      }
    }
  } catch (error) {
    logger.error("Could not load ended dare windows:", error);
    Sentry.captureException(error, {
      tags: { source: "betting-dare-sweep-window-load" },
    });
  }
  return summaries;
}
