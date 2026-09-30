import { z } from "zod";
import {
  type BucksAmount,
  BucksAmountSchema,
  type BucksDelta,
  BucksDeltaSchema,
  type BucksStake,
  BucksStakeSchema,
} from "@scout-for-lol/domain/identity/bucks-money.ts";

/**
 * The Bryan Bucks storage edge.
 *
 * The semantic brands — what a quantity means — live in
 * `@scout-for-lol/domain` and are re-exported below so the existing
 * `@scout-for-lol/data` import sites keep receiving the SAME schema objects.
 * Zod brands are structural: an independently defined schema carrying the
 * same tag typechecks identically while validating differently, so the shim
 * re-exports rather than redeclares.
 *
 * What stays here is the part domain must not know: Prisma's `Int` column is
 * 32 bits wide, and a value bound for one has to fit. The `Storable*` schemas
 * below add exactly that bound on top of a semantic brand, and the helpers
 * raise `BucksStorageOverflowError` — the signal the settlement, placement,
 * and dare paths already catch to refund, void, or reject — instead of a bare
 * `ZodError`.
 *
 * A `StorableBucksAmount` IS a `BucksAmount` (the brands intersect), so
 * checking storability never forces a conversion on the way back out. Only
 * code that genuinely requires a storable value has to say so.
 */

/** Prisma's SQLite/Postgres `Int` client boundary. The economy intentionally
 * remains on Int32 storage for this version even though the product no longer
 * applies a smaller stake cap. */
export const BUCKS_INT32_MAX = 2_147_483_647;

/**
 * A value could not be written because the `Int` column cannot hold it.
 *
 * Thrown by the storable helpers and by `applyBucksDelta`, and caught by
 * every path that can recover: pool settlement retries as a matched-principal
 * refund, dare settlement voids with a full refund, and placement turns it
 * into a "storage limit" reply. Recovery keys off the class, so this is the
 * one definition — the backend ledger module re-exports this object rather
 * than declaring a second class that no `instanceof` would match.
 */
export class BucksStorageOverflowError extends Error {
  constructor(readonly bucksAccountId: number) {
    super(
      `Bucks account ${bucksAccountId.toString()} would exceed Int32 storage`,
    );
    this.name = "BucksStorageOverflowError";
  }
}

export {
  type BucksAmount,
  BucksAmountSchema,
  type BucksDelta,
  BucksDeltaSchema,
  type BucksPoolTotal,
  BucksPoolTotalSchema,
  type BucksStake,
  BucksStakeSchema,
  ZERO_BUCKS,
  addAmounts,
  amountToStake,
  applyDelta,
  creditOf,
  debitOf,
  stakeToAmount,
  subtractAmounts,
  sumToPoolTotal,
} from "@scout-for-lol/domain/identity/bucks-money.ts";

// `.check(z.lte(...))` rather than `.refine(...)`: a check keeps the bound
// visible to `z.toJSONSchema`, so the generated contract schemas published
// from these types still advertise the Int32 ceiling. A refine would validate
// identically and emit nothing.

/** A stake the `Int` column can hold. */
export const StorableBucksStakeSchema = BucksStakeSchema.check(
  z.lte(BUCKS_INT32_MAX),
).brand<"StorableBucks">();
export type StorableBucksStake = z.infer<typeof StorableBucksStakeSchema>;

/** An amount the `Int` column can hold. */
export const StorableBucksAmountSchema = BucksAmountSchema.check(
  z.lte(BUCKS_INT32_MAX),
).brand<"StorableBucks">();
export type StorableBucksAmount = z.infer<typeof StorableBucksAmountSchema>;

/** A ledger movement whose magnitude the `Int` column can hold. */
export const StorableBucksDeltaSchema = BucksDeltaSchema.check(
  z.gte(0 - BUCKS_INT32_MAX),
  z.lte(BUCKS_INT32_MAX),
).brand<"StorableBucks">();
export type StorableBucksDelta = z.infer<typeof StorableBucksDeltaSchema>;

/**
 * Assert a semantically valid stake is also storable.
 *
 * The argument is already branded, so the only way the check can fail is the
 * storage bound — which is why failure raises the overflow error rather than
 * surfacing the `ZodError`. Callers that must not throw (user input, quote
 * arithmetic) use `StorableBucksStakeSchema.safeParse` directly.
 */
export function storableStake(
  stake: BucksStake,
  bucksAccountId: number,
): StorableBucksStake {
  const storable = StorableBucksStakeSchema.safeParse(stake);
  if (!storable.success) {
    throw new BucksStorageOverflowError(bucksAccountId);
  }
  return storable.data;
}

/** Assert a semantically valid amount is also storable. */
export function storableAmount(
  amount: BucksAmount,
  bucksAccountId: number,
): StorableBucksAmount {
  const storable = StorableBucksAmountSchema.safeParse(amount);
  if (!storable.success) {
    throw new BucksStorageOverflowError(bucksAccountId);
  }
  return storable.data;
}

/** Assert a semantically valid ledger movement is also storable. */
export function storableDelta(
  delta: BucksDelta,
  bucksAccountId: number,
): StorableBucksDelta {
  const storable = StorableBucksDeltaSchema.safeParse(delta);
  if (!storable.success) {
    throw new BucksStorageOverflowError(bucksAccountId);
  }
  return storable.data;
}
