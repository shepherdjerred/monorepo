import type { Prisma } from "#generated/prisma/client/index.js";

type ReadinessClient = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;

/**
 * SQL-only startup check, run after `prisma migrate deploy`: a migrated
 * database is ready unless a Bucks balance disagrees with its ledger.
 */
export async function assertDatabasePrepared(
  db: ReadinessClient,
): Promise<void> {
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
