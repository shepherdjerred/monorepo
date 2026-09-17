import type { Db } from "#src/database/index.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  matchProcessingReceiptRecordToRow,
  matchProcessingReceiptRowToRecord,
  type MatchProcessingReceiptRecord,
} from "#src/database/durable/receipt-row.ts";
import { scoutDurableReceiptsRecorded } from "#src/metrics/durable-pipeline.ts";

/**
 * Repository for MatchProcessingReceipt.
 *
 * Mirrors the domain's recordReceipt: identity is `(kind, version, scope)`
 * within one match, a replay carrying the same evidence is `already-applied`,
 * and a replay whose evidence disagrees is a conflict — something recorded the
 * same fact twice with different claims about it, and the table keeps the
 * first. The unique constraint is what makes the answer authoritative under
 * concurrency.
 *
 * `recordedAt` is NOT part of that comparison, and this is the layer where
 * including it did visible damage. It is wall-clock at write time and receipt
 * writers are Temporal Activities, so an ordinary retry of an already-
 * committed write differs in exactly that column and in nothing else — every
 * one of them was answered `conflict`, inflating the counter the dual-write
 * alerting watches with events that are the system working correctly. The
 * evidence blob is the claim about the fact; the timestamp only records when
 * the first writer happened to look.
 */

export type RecordReceiptResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "receipt-evidence-mismatch" };

/**
 * Record a receipt, and count what the table said about it.
 *
 * This is the one place every receipt write passes through, which is why the
 * counter is here rather than at each of the four modules that own receipt
 * kinds: a kind added by a later wave is observable the day it is written,
 * without anyone remembering to instrument it. The kind is safe as a label for
 * the same reason — it can only ever be a literal one of those modules
 * declared, never a value carried in from a match, a guild or a request.
 *
 * A throw is deliberately not counted. The read-back miss below is a broken
 * invariant rather than an outcome, and giving it a series would file it
 * alongside the three answers the table can legitimately give.
 */
export async function recordReceipt(
  db: Db,
  record: MatchProcessingReceiptRecord,
): Promise<RecordReceiptResult> {
  const result = await applyReceipt(db, record);
  scoutDurableReceiptsRecorded.inc({
    receipt_kind: record.receipt.kind,
    outcome: result.outcome,
  });
  return result;
}

async function applyReceipt(
  db: Db,
  record: MatchProcessingReceiptRecord,
): Promise<RecordReceiptResult> {
  const row = matchProcessingReceiptRecordToRow(record);
  const created = await db.matchProcessingReceipt.createMany({
    data: [row],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.matchProcessingReceipt.findUnique({
    where: {
      riotMatchId_kind_version_scopeKey: {
        riotMatchId: row.riotMatchId,
        kind: row.kind,
        version: row.version,
        scopeKey: row.scopeKey,
      },
    },
  });
  if (existing === null) {
    throw new Error(
      `MatchProcessingReceipt ${row.scopeKey} for ${row.riotMatchId} vanished between a duplicate insert and its read-back`,
    );
  }
  const sameEvidence = existing.evidence === row.evidence;
  return sameEvidence
    ? { outcome: "already-applied" }
    : { outcome: "conflict", reason: "receipt-evidence-mismatch" };
}

export async function listReceipts(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<MatchProcessingReceiptRecord[]> {
  const rows = await db.matchProcessingReceipt.findMany({
    where: { riotMatchId: args.matchId },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => matchProcessingReceiptRowToRecord(row));
}
