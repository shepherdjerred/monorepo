import type { ExtendedPrismaClient } from "#src/database/index.ts";
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

type ObservationDb = Pick<ExtendedPrismaClient, "matchObservation">;
type ProcessingDb = Pick<
  ExtendedPrismaClient,
  "matchObservation" | "matchProcessingReceipt"
>;

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

async function resolveObservedConflict(
  db: ObservationDb,
  row: MatchObservationRow,
): Promise<ObserveMatchResult> {
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
  if (!Bun.deepEquals(ownerNeutral(existingRow), ownerNeutral(row), true)) {
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
    if (claimed.count === 1) {
      return { outcome: "applied" };
    }
    return await resolveObservedConflict(db, row);
  }
  if (row.pipelineOwner === null) {
    // The observation itself is already recorded; not claiming is not a
    // conflict with whoever did.
    return { outcome: "already-applied" };
  }
  return { outcome: "conflict", reason: "ownership-held-by-another-owner" };
}

/**
 * Record one observed match, claiming ownership when the record carries an
 * assigned owner. Exactly one of two racing writers applies; the loser gets
 * `already-applied` for an identical retry, an ownership conflict for a
 * different claimant, and `observation-differs` when the facts themselves
 * disagree (which is a bug upstream, surfaced as a conflict so the caller
 * decides how loudly to fail).
 */
export async function observeMatch(
  db: ObservationDb,
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
  return await resolveObservedConflict(db, row);
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
  db: ObservationDb,
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
  db: ObservationDb,
  args: { matchId: RiotMatchId },
): Promise<MatchObservationRecord | null> {
  const row = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  return row === null ? null : matchObservationRowToRecord(row);
}

/**
 * Assemble the full domain MatchProcessingState for one match, scoped to one
 * receipt (kind, version). The stored receipt identity is wider than the
 * domain's (which keys receipts by scope alone), so the domain's
 * one-receipt-per-scope invariant holds per (kind, version) — the caller
 * names which receipt family it is transitioning over.
 */
export async function getProcessingState(
  db: ProcessingDb,
  args: { matchId: RiotMatchId; receiptKind: string; receiptVersion: number },
): Promise<MatchProcessingState | null> {
  const observation = await db.matchObservation.findUnique({
    where: { riotMatchId: args.matchId },
  });
  if (observation === null) {
    return null;
  }
  const record = matchObservationRowToRecord(observation);
  const receiptRows = await db.matchProcessingReceipt.findMany({
    where: {
      riotMatchId: args.matchId,
      kind: args.receiptKind,
      version: args.receiptVersion,
    },
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
