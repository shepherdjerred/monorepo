import type { Db } from "#src/database/index.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  matchProcessingReceiptRecordToRow,
  matchProcessingReceiptRowToRecord,
  type MatchProcessingReceiptRecord,
} from "#src/database/durable/receipt-row.ts";

/**
 * Repository for MatchProcessingReceipt.
 *
 * Mirrors the domain's recordReceipt: identity is `(kind, version, scope)`
 * within one match, an exact replay — same identity, same evidence — is
 * `already-applied`, and a replay whose evidence disagrees is a conflict
 * (something recorded the same fact twice with different observations; the
 * table keeps the first). The unique constraint is what makes the answer
 * authoritative under concurrency.
 */

export type RecordReceiptResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "receipt-evidence-mismatch" };

export async function recordReceipt(
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
  const sameEvidence =
    existing.recordedAt.getTime() === row.recordedAt.getTime() &&
    existing.evidence === row.evidence;
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
