import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  matchProcessingReceiptRecordToRow,
  matchProcessingReceiptRowToRecord,
  type MatchProcessingReceiptRecord,
} from "#src/database/durable/receipt-row.ts";

/**
 * Repository for MatchProcessingReceipt.
 *
 * Mirrors the domain's recordReceipt: receipt identity is the scope key
 * (within one match, kind, and version), and recording the same identity
 * twice is `already-applied` regardless of timestamp or evidence — the
 * database's unique constraint is what makes that answer authoritative under
 * concurrency.
 */

type ReceiptDb = Pick<ExtendedPrismaClient, "matchProcessingReceipt">;

export type RecordReceiptResult =
  { outcome: "applied" } | { outcome: "already-applied" };

export async function recordReceipt(
  db: ReceiptDb,
  record: MatchProcessingReceiptRecord,
): Promise<RecordReceiptResult> {
  const row = matchProcessingReceiptRecordToRow(record);
  const created = await db.matchProcessingReceipt.createMany({
    data: [row],
    skipDuplicates: true,
  });
  return created.count === 1
    ? { outcome: "applied" }
    : { outcome: "already-applied" };
}

export async function listReceipts(
  db: ReceiptDb,
  args: { matchId: RiotMatchId },
): Promise<MatchProcessingReceiptRecord[]> {
  const rows = await db.matchProcessingReceipt.findMany({
    where: { riotMatchId: args.matchId },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => matchProcessingReceiptRowToRecord(row));
}
