import { z } from "zod";
import type { Prisma } from "#generated/prisma/client/index.js";

const ImportReceiptSchema = z
  .strictObject({
    id: z.literal(1),
    imported_at: z.date(),
    source: z.string().min(1),
    source_size_bytes: z.bigint().nonnegative(),
    source_digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    row_counts: z.record(z.string().min(1), z.number().int().nonnegative()),
  })
  .refine(
    (receipt) =>
      receipt.source === "none"
        ? receipt.source_size_bytes === 0n &&
          receipt.source_digest === null &&
          Object.keys(receipt.row_counts).length === 0
        : receipt.source_size_bytes > 0n &&
          receipt.source_digest !== null &&
          Object.keys(receipt.row_counts).length > 0,
    "Incomplete legacy import receipt",
  );

type ReadinessClient = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;

/** SQL-only startup check. Retained SQLite snapshots are recovery inputs. */
export async function assertDatabasePrepared(
  db: ReadinessClient,
): Promise<void> {
  const tables = await db.$queryRawUnsafe<{ present: boolean }[]>(
    "SELECT to_regclass('_legacy_sqlite_import') IS NOT NULL AS present",
  );
  if (tables[0]?.present !== true) {
    throw new Error(
      "Database is not prepared: run the explicit legacy import before startup",
    );
  }
  const rows = await db.$queryRawUnsafe<unknown[]>(
    "SELECT id, imported_at, source, source_size_bytes, source_digest, row_counts FROM _legacy_sqlite_import",
  );
  if (rows.length !== 1 || !ImportReceiptSchema.safeParse(rows[0]).success) {
    throw new Error(
      "Database has no valid completed legacy import receipt; explicit preparation or recovery is required",
    );
  }
  const drift = await verifyLedgerBalances(db);
  if (drift.length > 0) {
    throw new Error(
      `Ledger drift (${drift.length.toString()} accounts) — refusing startup: ${drift.join("; ")}`,
    );
  }
}

/** One statement compares balances and deltas from the same database snapshot. */
export async function verifyLedgerBalances(
  db: ReadinessClient,
): Promise<string[]> {
  const drift = await db.$queryRawUnsafe<
    { id: number; balance: number; expected: bigint }[]
  >(`
    SELECT account.id, account.balance, COALESCE(ledger.total, 0)::bigint AS expected
    FROM "BucksAccount" AS account
    LEFT JOIN (
      SELECT "bucksAccountId", SUM(delta) AS total
      FROM "BucksLedgerEntry"
      GROUP BY "bucksAccountId"
    ) AS ledger ON ledger."bucksAccountId" = account.id
    WHERE account.balance <> COALESCE(ledger.total, 0)
    ORDER BY account.id
  `);
  return drift.map(
    (account) =>
      `BucksAccount ${account.id.toString()}: balance ${account.balance.toString()} != ledger sum ${account.expected.toString()}`,
  );
}
