/**
 * Doubles for tests that exercise a fenced archive door without a real
 * database.
 *
 * Every door in `report-lake/receipted-archive.ts` wraps its read-gate, put and
 * attestation in one advisory-locked transaction, so any suite that calls one
 * needs a client double capable of RUNNING a transaction — a bare `{}` throws
 * on `$transaction`. The lock's actual serialization is a property of Postgres
 * and is proved against a real one in
 * `report-lake/archive-fence.integration.test.ts`; a double could only ever
 * serialize by construction and would prove nothing.
 *
 * This lives here rather than inline so the several suites that merely pass
 * THROUGH the door — they are about receipts, or about ingest — do not each
 * carry their own copy of a transaction stub they never look at.
 */

/**
 * A Prisma client double whose `$transaction` runs its callback immediately,
 * handing it a transaction stub that accepts the advisory-lock statements.
 *
 * `available` lets a suite take the database away: a door that must not open
 * a transaction on some path — the no-bucket no-op — is proved by a double
 * that refuses to open one, which is stronger than a double that quietly
 * would have.
 */
export function transactionRunningPrismaDouble(
  options: { available?: () => boolean } = {},
): {
  $transaction: (run: (tx: unknown) => unknown) => unknown;
} {
  return {
    $transaction: (run) => {
      if (options.available?.() === false) {
        throw new Error("no database available");
      }
      return run({ $executeRaw: () => Promise.resolve(0) });
    },
  };
}
