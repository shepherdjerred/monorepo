import type { Db } from "#src/database/index.ts";
import type {
  IsoInstant,
  RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  MatchProcessingStateSchema,
  type MatchProcessingState,
} from "@scout-for-lol/domain/match-processing/states.ts";
import {
  matchObservationRecordToRow,
  matchObservationRowToRecord,
  type MatchObservationRecord,
  type MatchObservationRow,
} from "#src/database/durable/observation-row.ts";
import { matchProcessingReceiptRowToRecord } from "#src/database/durable/receipt-row.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Repository for MatchObservation.
 *
 * Ownership of a match lives on the row's primary key: observeMatch is an
 * insert-or-conflict claim, and promotion is a guarded update, both mirroring
 * the pure domain transitions (claimOwnership, promoteArchiveOnlyToFull) as
 * single guarded statements so racing writers get an expected `conflict`
 * result instead of an exception or a silent overwrite.
 */

const OBSERVE_ATTEMPTS = 3;

export type ObserveMatchResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | {
      outcome: "conflict";
      reason: "ownership-held-by-another-owner" | "observation-differs";
    };

function ownerNeutral(row: MatchObservationRow): MatchObservationRow {
  return { ...row, pipelineOwner: null };
}

/**
 * A promoted row seen by a delayed retry of the ORIGINAL observation: the
 * incoming ARCHIVE_ONLY observation matches the stored row's pre-promotion
 * form exactly. An ordinary Temporal retry of observeMatch after a promotion
 * raced past it is benign, not upstream disagreement — only rows whose facts
 * genuinely diverge should conflict.
 */
function isRetryOfPrePromotionObservation(
  existing: MatchObservationRow,
  incoming: MatchObservationRow,
): boolean {
  if (existing.processingPolicy !== "FULL" || existing.promotedAt === null) {
    return false;
  }
  if (
    incoming.processingPolicy !== "ARCHIVE_ONLY" ||
    incoming.promotedAt !== null
  ) {
    return false;
  }
  const prePromotionForm = {
    ...existing,
    processingPolicy: "ARCHIVE_ONLY",
    promotedAt: null,
  };
  return Bun.deepEquals(
    ownerNeutral(prePromotionForm),
    ownerNeutral(incoming),
    true,
  );
}

async function resolveObservedConflict(
  db: Db,
  row: MatchObservationRow,
): Promise<ObserveMatchResult | "retry"> {
  const existing = await db.matchObservation.findUnique({
    where: { riotMatchId: row.riotMatchId },
  });
  if (existing === null) {
    throw new Error(
      `MatchObservation ${row.riotMatchId} vanished between a duplicate insert and its read-back`,
    );
  }
  const existingRow = matchObservationRecordToRow(
    matchObservationRowToRecord(existing),
  );
  if (Bun.deepEquals(existingRow, row, true)) {
    return { outcome: "already-applied" };
  }
  const sameObservation =
    Bun.deepEquals(ownerNeutral(existingRow), ownerNeutral(row), true) ||
    isRetryOfPrePromotionObservation(existingRow, row);
  if (!sameObservation) {
    return { outcome: "conflict", reason: "observation-differs" };
  }
  // Same observation, different owner columns. NULL is the domain's
  // `unowned`: an observation that arrives with an assigned owner claims an
  // unowned row with a guarded update, exactly like claimOwnership.
  if (existingRow.pipelineOwner === null && row.pipelineOwner !== null) {
    const claimed = await db.matchObservation.updateMany({
      where: { riotMatchId: row.riotMatchId, pipelineOwner: null },
      data: { pipelineOwner: row.pipelineOwner },
    });
    return claimed.count === 1 ? { outcome: "applied" } : "retry";
  }
  if (
    row.pipelineOwner === null ||
    row.pipelineOwner === existingRow.pipelineOwner
  ) {
    // The observation itself is already recorded, and either the retry does
    // not claim at all or the claim it repeats is the one already held.
    return { outcome: "already-applied" };
  }
  return { outcome: "conflict", reason: "ownership-held-by-another-owner" };
}

/**
 * Record one observed match, claiming ownership when the record carries an
 * assigned owner. Exactly one of two racing writers applies; the loser gets
 * `already-applied` for an identical retry — including a delayed retry of the
 * original ARCHIVE_ONLY observation after a promotion raced past it — an
 * ownership conflict for a different claimant, and `observation-differs` only
 * when the facts themselves genuinely disagree (which is a bug upstream,
 * surfaced as a conflict so the caller decides how loudly to fail).
 */
export async function observeMatch(
  db: Db,
  record: MatchObservationRecord,
): Promise<ObserveMatchResult> {
  const row = matchObservationRecordToRow(record);
  const created = await db.matchObservation.createMany({
    data: [row],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { outcome: "applied" };
  }
  for (let attempt = 0; attempt < OBSERVE_ATTEMPTS; attempt += 1) {
    const resolved = await resolveObservedConflict(db, row);
    if (resolved !== "retry") {
      return resolved;
    }
  }
  throw new Error(
    `Gave up observing ${row.riotMatchId} after ${String(OBSERVE_ATTEMPTS)} contended attempts`,
  );
}

export type PromoteObservationResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "promotion-target-born-full" };

/**
 * Promote an ARCHIVE_ONLY observation to FULL, at most once. Mirrors
 * promoteArchiveOnlyToFull: a retry on the promoted row is `already-applied`
 * and a row born FULL is a conflict. Promoting a match that was never
 * observed is a broken caller contract and throws.
 */
export async function promoteObservation(
  db: Db,
  args: { matchId: RiotMatchId; promotedAt: IsoInstant },
): Promise<PromoteObservationResult> {
  const promoted = await db.matchObservation.updateMany({
    where: { riotMatchId: args.matchId, processingPolicy: "ARCHIVE_ONLY" },
    data: {
      processingPolicy: "FULL",
      promotedAt: dateFromIsoInstant(args.promotedAt),
    },
  });
  if (promoted.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  if (existing === null) {
    throw new Error(
      `Cannot promote ${args.matchId}: the match was never observed`,
    );
  }
  const record = matchObservationRowToRecord(existing);
  return record.promotion === null
    ? { outcome: "conflict", reason: "promotion-target-born-full" }
    : { outcome: "already-applied" };
}

export async function getObservation(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<MatchObservationRecord | null> {
  const row = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  return row === null ? null : matchObservationRowToRecord(row);
}

/**
 * Assemble the full domain MatchProcessingState for one match — owner,
 * policy, promotion, and every receipt across all kinds. Receipt identity is
 * `(kind, version, scope)` in both the domain and the unique constraint, so
 * the whole set satisfies the state's uniqueness invariant directly.
 */
export async function getProcessingState(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<MatchProcessingState | null> {
  const observation = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  if (observation === null) {
    return null;
  }
  const record = matchObservationRowToRecord(observation);
  const receiptRows = await db.matchProcessingReceipt.findMany({
    where: { riotMatchId: args.matchId },
    orderBy: { id: "asc" },
  });
  const receipts = receiptRows.map((receiptRow) => {
    const receiptRecord = matchProcessingReceiptRowToRecord(receiptRow);
    return receiptRecord.receipt;
  });
  return MatchProcessingStateSchema.parse({
    matchId: record.matchId,
    owner: record.owner,
    policy: record.policy,
    promotion: record.promotion,
    receipts,
  });
}
