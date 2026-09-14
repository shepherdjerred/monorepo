/**
 * Keeping every live claim about an object's bytes true after a rewrite.
 *
 * Two kinds of record name a stored object by content, and both stop being true
 * the moment its bytes change.
 *
 * `MatchObservation` pairs a key with the SHA-256 of its canonical bytes, and
 * the schema is explicit that a different digest arriving later is a conflict —
 * two producers disagreeing — rather than an update.
 *
 * A `raw-archive-*` receipt is not the historical record it looks like. Its
 * evidence is the descriptor handed to `readVerifiedRawObjectText` when the
 * snapshot is read back, and a digest mismatch there is TERMINAL: the resume
 * path turns it into a non-retryable failure and drops the remaining lake
 * projection and notifications. So it attests the bytes stored now, and it moves
 * with them.
 *
 * `lake-staging-*` receipts are left alone, and that difference is the point.
 * Those say rows were derived from particular bytes at a particular time, which
 * stays true after the object changes — rewriting one would falsify a record of
 * the past to tidy the present.
 */

import { rawArchiveEvidenceCodec } from "@scout-for-lol/backend/report-lake/durable-receipts.ts";
import type { Db } from "#scripts/puuid-migration/db.ts";
import {
  asOptionalString,
  countOf,
  toSqlParam,
} from "#scripts/puuid-migration/support.ts";

/** Point the stored artifact reference at the bytes now under that key. */
export async function recordRewrittenDigest(
  db: Db,
  key: string,
  digest: string,
): Promise<number> {
  let updated = 0;
  for (const column of ["matchObjectKey", "timelineObjectKey"] as const) {
    const digestColumn =
      column === "matchObjectKey" ? "matchDigest" : "timelineDigest";
    await db.exec(
      `UPDATE "MatchObservation" SET "${digestColumn}" = ${db.param(2)}
        WHERE "${column}" = ${db.param(1)} AND "${digestColumn}" <> ${db.param(2)}`,
      [key, digest],
    );
    const rows = await db.query(
      `SELECT COUNT(*) AS n FROM "MatchObservation"
        WHERE "${column}" = ${db.param(1)} AND "${digestColumn}" = ${db.param(2)}`,
      [key, digest],
    );
    updated += countOf(rows, "observation digest");
  }
  return updated;
}

/** Whether this database even models observations; prod's older one does not. */
export async function hasObservations(db: Db): Promise<boolean> {
  const tables = await db.listTables();
  return tables.includes("MatchObservation");
}

/** Receipt kinds whose evidence is checked against the object on every read. */
const LIVE_RECEIPT_KINDS = [
  "raw-archive-match",
  "raw-archive-timeline",
  "raw-archive-prematch",
] as const;

/**
 * Move a receipt's attested digest onto the bytes now under its key.
 *
 * The evidence is an artifact descriptor stored as JSON, so the key is matched
 * inside it and only the digest is replaced — everything else the descriptor
 * records about the capture stays as it was.
 */
export async function repointReceipts(
  db: Db,
  key: string,
  digest: string,
): Promise<number> {
  const placeholders = LIVE_RECEIPT_KINDS.map((_, i) => db.param(i + 2)).join(
    ", ",
  );
  const rows = await db.query(
    `SELECT "id" AS id, "evidence" AS evidence FROM "MatchProcessingReceipt"
      WHERE "kind" IN (${placeholders}) AND "evidence" LIKE ${db.param(1)}`,
    [`%${key}%`, ...LIVE_RECEIPT_KINDS],
  );

  let moved = 0;
  for (const row of rows) {
    const evidence = asOptionalString(row["evidence"]);
    const id = row["id"];
    if (evidence === null || id === null || id === undefined) {
      continue;
    }
    const parsed: unknown = JSON.parse(evidence);
    const updated = withDigest(parsed, key, digest);
    if (updated === null) {
      continue;
    }
    await db.exec(
      `UPDATE "MatchProcessingReceipt" SET "evidence" = ${db.param(2)} WHERE "id" = ${db.param(1)}`,
      [toSqlParam(id, "receipt id"), JSON.stringify(updated)],
    );
    moved++;
  }
  return moved;
}

/**
 * Replace the digest in a descriptor that names this key, or report no match.
 *
 * The evidence is read and written with the same codec the reader uses, rather
 * than by walking the JSON. An earlier version of this walked for a `key` at
 * the top level and recursed through a `payload` property, and neither exists:
 * `rawArchiveEvidenceCodec` wraps the descriptor in a strict
 * `{ kind, version, data }` envelope, so every match fell through and no
 * receipt ever moved. Borrowing the codec is what makes that class of
 * disagreement impossible — the script cannot hold an opinion about the shape
 * that the reader does not share.
 *
 * Parsing is also the check. A `LIKE` can match a receipt that merely mentions
 * the key, and an envelope this codec cannot read is a broken contract rather
 * than a receipt to skip: leaving a live claim stale would strand exactly the
 * workflows this function exists to protect, so it fails loudly.
 */
function withDigest(
  evidence: unknown,
  key: string,
  digest: string,
): ReturnType<typeof rawArchiveEvidenceCodec.serialize> | null {
  const descriptor = rawArchiveEvidenceCodec.parse(evidence);
  if (descriptor.key !== key) {
    return null;
  }
  // Re-parsed rather than spread onto the branded type: the replacement digest
  // arrives as a plain string, and the codec is what decides it is a digest.
  return rawArchiveEvidenceCodec.serialize(
    rawArchiveEvidenceCodec.parse({
      kind: rawArchiveEvidenceCodec.kind,
      version: rawArchiveEvidenceCodec.version,
      data: { ...descriptor, digest },
    }),
  );
}

/**
 * How many prematch snapshots are attested by a receipt a reader still checks.
 *
 * Only the prematch path reads an archived object back and verifies it against
 * its receipt, and `prematch-resume.ts` turns a mismatch into a non-retryable
 * failure. A rewrite cannot make the S3 PUT and the receipt update one atomic
 * step, so for an instant the stored bytes and the attested digest disagree,
 * and a resume landing in that instant loses its lake projection and
 * notifications for good.
 *
 * Which snapshots can actually be read in that instant is a question about
 * open workflows, not about this database, so the count is reported and the
 * operator decides. Match and timeline receipts are not counted: nothing reads
 * them back, so moving them is bookkeeping rather than a race.
 */
export async function countPrematchReceipts(db: Db): Promise<number> {
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "MatchProcessingReceipt" WHERE "kind" = ${db.param(1)}`,
    ["raw-archive-prematch"],
  );
  return countOf(rows, "prematch receipt");
}

/** Whether this database records processing receipts at all. */
export async function hasReceipts(db: Db): Promise<boolean> {
  const tables = await db.listTables();
  return tables.includes("MatchProcessingReceipt");
}
