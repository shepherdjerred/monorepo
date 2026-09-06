import { z } from "zod";
import {
  IsoInstantSchema,
  RecoveryBatchIdSchema,
} from "#src/identity/brands.ts";

/**
 * Recovery batch contract.
 *
 * A recovery batch replays work missed during an outage: it scans a bounded
 * number of pages, processes what it discovered, digests the outcome for an
 * operator, and completes. The machine is pure — cursors, counts, and
 * timestamps are parameters.
 *
 * The policy caps the batch's external blast radius and is immutable after
 * creation, with one exception: an operator may release `no-external` to
 * `stale-private-only`, never to `normal`.
 */

export type RecoveryPolicy = z.infer<typeof RecoveryPolicySchema>;
export const RecoveryPolicySchema = z.enum([
  "normal",
  "stale-private-only",
  "no-external",
]);

/**
 * Bounded scan cursor. `position` is the opaque resume token of the page to
 * scan next; it is absent before the first page. A batch may scan at most
 * `pageBudget` pages, so an unbounded upstream cannot pin a batch forever.
 */
export type RecoveryScanCursor = z.infer<typeof RecoveryScanCursorSchema>;
export const RecoveryScanCursorSchema = z
  .strictObject({
    position: z.string().min(1).optional(),
    pagesScanned: z.int().nonnegative(),
    pageBudget: z.int().positive(),
  })
  .refine((cursor) => cursor.pagesScanned <= cursor.pageBudget, {
    message: "pagesScanned must not exceed pageBudget",
  });

export type RecoveryCounts = z.infer<typeof RecoveryCountsSchema>;
export const RecoveryCountsSchema = z
  .strictObject({
    discovered: z.int().nonnegative(),
    succeeded: z.int().nonnegative(),
    suppressed: z.int().nonnegative(),
    failed: z.int().nonnegative(),
  })
  .refine(
    (counts) =>
      counts.succeeded + counts.suppressed + counts.failed <= counts.discovered,
    { message: "processed items must not exceed discovered items" },
  );

export type RecoveryAbandonReason = z.infer<typeof RecoveryAbandonReasonSchema>;
export const RecoveryAbandonReasonSchema = z.enum([
  "operator-cancelled",
  "scan-budget-exhausted",
  "upstream-unavailable",
  "superseded",
]);

export type RecoveryBatchState = z.infer<typeof RecoveryBatchStateSchema>;
export const RecoveryBatchStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("planned") }),
  z.strictObject({
    kind: z.literal("scanning"),
    cursor: RecoveryScanCursorSchema,
  }),
  z.strictObject({
    kind: z.literal("processing"),
    counts: RecoveryCountsSchema,
  }),
  z.strictObject({ kind: z.literal("digesting") }),
  z.strictObject({ kind: z.literal("complete") }),
  z.strictObject({
    kind: z.literal("abandoned"),
    reason: RecoveryAbandonReasonSchema,
  }),
]);

export type RecoveryBatch = z.infer<typeof RecoveryBatchSchema>;
export const RecoveryBatchSchema = z.strictObject({
  id: RecoveryBatchIdSchema,
  policy: RecoveryPolicySchema,
  createdAt: IsoInstantSchema,
  state: RecoveryBatchStateSchema,
});
