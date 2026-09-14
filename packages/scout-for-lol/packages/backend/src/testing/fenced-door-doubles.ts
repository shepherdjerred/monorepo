/**
 * Doubles for tests that exercise the fenced prematch archive door without a
 * real database.
 *
 * `archivePrematchReceipted` wraps its read-gate, put and attestation in one
 * advisory-locked transaction, so any suite that calls it needs a client double
 * capable of RUNNING a transaction — a bare `{}` throws on `$transaction`. The
 * lock's actual serialization is a property of Postgres and is proved against a
 * real one in `report-lake/prematch-archive-fence.integration.test.ts`; a
 * double could only ever serialize by construction and would prove nothing.
 *
 * This lives here rather than inline so the several suites that merely pass
 * THROUGH the door — they are about receipts, or about ingest — do not each
 * carry their own copy of a transaction stub they never look at.
 */

/**
 * A Prisma client double whose `$transaction` runs its callback immediately,
 * handing it a transaction stub that accepts the advisory-lock statement.
 */
export function transactionRunningPrismaDouble(): {
  $transaction: (run: (tx: unknown) => unknown) => unknown;
} {
  return {
    $transaction: (run) => run({ $executeRaw: () => Promise.resolve(0) }),
  };
}
