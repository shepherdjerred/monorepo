import type { ReceiptKind } from "@scout-for-lol/domain/match-processing/states.ts";
import type { Db } from "#src/database/index.ts";
import {
  listLiveRecoveryBatches,
  listStalledV2MatchProcessing,
  listUnacceptedWorkflowStarts,
  listUnprojectedLakeMatches,
} from "#src/database/durable/pipeline-scan.ts";

/**
 * What the durable tables say, in the shape a Prometheus scrape wants.
 *
 * `pipeline-scan.ts` answers "which rows" — bounded, ordered pages that the
 * reconciliation sweep turns into child Workflows and the operations console
 * turns into a queue an operator can act on. A scrape wants neither. It wants
 * two scalars per family: how many rows are sitting there, and how long the
 * oldest one has been sitting. This module is those two questions and nothing
 * else.
 *
 * The oldest-row reads are deliberately the SAME functions the sweep and the
 * console run, called with `limit: 1`. Every one of them already orders by the
 * age key ascending, so the head of the first page IS the oldest row; asking
 * for it again in a second query would mean a second copy of predicates whose
 * exactness is the whole point — the stalled-match family alone is a raw
 * anti-join across three tables, and a metric quietly measuring a slightly
 * different population than the sweep drives is worse than no metric, because
 * it reads as agreement.
 *
 * The distribution reads are `groupBy` over a whole table with no predicate at
 * all, so there is nothing to keep in step: one row per state that exists, and
 * the caller zero-fills the states that do not. Both ride the `(state, …)`
 * indexes the scan reads already depend on.
 *
 * Receipt kinds and workflow types arrive as arguments rather than as imports,
 * for the reason `pipeline-scan.ts` does the same: the persistence layer is
 * driven by the application and must not hold its vocabularies.
 */

/** Rows per state, keyed by the stored `state` column, absent when zero. */
export type DurableStateCounts = ReadonlyMap<string, number>;

function countByState(
  rows: readonly { state: string; _count: { _all: number } }[],
): DurableStateCounts {
  return new Map(rows.map((row) => [row.state, row._count._all]));
}

export async function countNotificationIntentsByState(
  db: Db,
): Promise<DurableStateCounts> {
  const rows = await db.matchNotificationIntent.groupBy({
    by: ["state"],
    _count: { _all: true },
  });
  return countByState(rows);
}

export async function countRecoveryBatchesByState(
  db: Db,
): Promise<DurableStateCounts> {
  const rows = await db.matchRecoveryBatch.groupBy({
    by: ["state"],
    _count: { _all: true },
  });
  return countByState(rows);
}

/**
 * When the longest-stranded V2 match was observed, or null when none is.
 *
 * Null is "the family is empty", which a caller must render as zero age rather
 * than as a missing series: a backlog that drained and a sweep that stopped
 * running have to stay distinguishable, and only the first of them is good
 * news.
 */
export async function oldestStalledMatchProcessingAt(
  db: Db,
  args: { observationReceiptKind: ReceiptKind },
): Promise<Date | null> {
  const [oldest] = await listStalledV2MatchProcessing(db, {
    observationReceiptKind: args.observationReceiptKind,
    // A contested match is still unfinished work; the gauge must not read a
    // backlog that an operator has to clear as a backlog that drained.
    contested: { kind: "include" },
    limit: 1,
  });
  return oldest?.observedAt ?? null;
}

export async function oldestLiveRecoveryBatchAt(db: Db): Promise<Date | null> {
  const [oldest] = await listLiveRecoveryBatches(db, { limit: 1 });
  return oldest?.createdAt ?? null;
}

/**
 * When the longest-unacknowledged start was requested, or null when none is.
 *
 * `requestedAt` comes back through the row codec as a branded ISO instant
 * rather than as a `Date`, so it is parsed here: the other families in this
 * module read raw ordering columns and hand back `Date` directly, and a caller
 * computing an age should not have to know which family it is holding.
 */
export async function oldestUnacceptedWorkflowStartAt(
  db: Db,
  args: { workflowTypes: readonly string[] },
): Promise<Date | null> {
  const [oldest] = await listUnacceptedWorkflowStarts(db, {
    workflowTypes: args.workflowTypes,
    limit: 1,
  });
  return oldest === undefined ? null : new Date(oldest.requestedAt);
}

/**
 * When the longest-unprojected artifact was archived, or null when none is.
 *
 * The receipt pair is the caller's to name because the anti-join is per
 * artifact kind — a match staged while its timeline is still waiting is a real
 * and common state, and folding the three kinds into one number would hide
 * exactly the half that is stuck.
 */
export async function oldestUnprojectedArchiveAt(
  db: Db,
  args: { archiveReceiptKind: ReceiptKind; stagingReceiptKind: ReceiptKind },
): Promise<Date | null> {
  const [oldest] = await listUnprojectedLakeMatches(db, {
    archiveReceiptKind: args.archiveReceiptKind,
    stagingReceiptKind: args.stagingReceiptKind,
    limit: 1,
  });
  return oldest?.archivedAt ?? null;
}
