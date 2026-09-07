import { z } from "zod";

/**
 * Branded Bryan Bucks money values.
 *
 * Every financial quantity in the Bucks economy is one of three shapes, and
 * the brands keep them from being silently interchanged:
 *
 * - `BucksStake` — a positive whole-BB commitment (a submitted stake, a
 *   transfer total, a dare pot). Zero is not a stake.
 * - `BucksAmount` — a non-negative whole-BB quantity (a matched portion, a
 *   payout, a fee). Zero is a legitimate amount.
 * - `BucksDelta` — a signed, non-zero ledger movement. Negative debits,
 *   positive credits; a zero delta is a bug, never a no-op.
 *
 * All three live inside Prisma's SQLite/Postgres `Int` storage domain, so the
 * checked helpers below re-validate the Int32 range on every operation and
 * throw on violation: an out-of-range result here is a broken internal
 * invariant, not user input.
 */

/** Prisma's SQLite `Int` client boundary. The economy intentionally remains
 * on Int32 storage for this version even though the product no longer applies
 * a smaller stake cap. */
export const BUCKS_INT32_MAX = 2_147_483_647;

/** Any positive whole-BB stake that the existing storage domain can hold. */
export type BucksStake = z.infer<typeof BucksStakeSchema>;
export const BucksStakeSchema = z
  .number()
  .int()
  .positive()
  .max(BUCKS_INT32_MAX)
  .brand<"BucksStake">();

/** Any non-negative whole-BB quantity the storage domain can hold. */
export type BucksAmount = z.infer<typeof BucksAmountSchema>;
export const BucksAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(BUCKS_INT32_MAX)
  .brand<"BucksAmount">();

/** A signed, non-zero whole-BB ledger movement within Int32 range. */
export type BucksDelta = z.infer<typeof BucksDeltaSchema>;
export const BucksDeltaSchema = z
  .number()
  .int()
  .min(-BUCKS_INT32_MAX)
  .max(BUCKS_INT32_MAX)
  .refine((value) => value !== 0, {
    message: "A Bucks delta of zero is a bug, not a no-op",
  })
  .brand<"BucksDelta">();

/** The zero amount, pre-branded so call sites need no parse for a literal 0. */
export const ZERO_BUCKS: BucksAmount = BucksAmountSchema.parse(0);

/** A stake is always a valid amount; the brands just differ. */
export function stakeToAmount(stake: BucksStake): BucksAmount {
  return BucksAmountSchema.parse(stake);
}

/** An amount known to be positive, reasserted as a stake. Throws on zero. */
export function amountToStake(amount: BucksAmount): BucksStake {
  return BucksStakeSchema.parse(amount);
}

/** Checked addition. Throws when the sum leaves the Int32 storage domain. */
export function addAmounts(
  first: BucksAmount,
  ...rest: readonly BucksAmount[]
): BucksAmount {
  return BucksAmountSchema.parse(
    rest.reduce<number>((sum, value) => sum + value, first),
  );
}

/** Checked subtraction. Throws when the result would be negative. */
export function subtractAmounts(
  minuend: BucksAmount,
  subtrahend: BucksAmount,
): BucksAmount {
  return BucksAmountSchema.parse(minuend - subtrahend);
}

/** Apply a signed movement to an amount. Throws when the result leaves the
 * non-negative Int32 domain. */
export function applyDelta(
  amount: BucksAmount,
  delta: BucksDelta,
): BucksAmount {
  return BucksAmountSchema.parse(amount + delta);
}

/** A positive ledger movement crediting `value`. Throws on a zero amount. */
export function creditOf(value: BucksStake | BucksAmount): BucksDelta {
  return BucksDeltaSchema.parse(value);
}

/** A negative ledger movement debiting `value`. Throws on a zero amount. */
export function debitOf(value: BucksStake | BucksAmount): BucksDelta {
  // `0 - value` rather than unary minus: no-unsafe-unary-minus cannot see
  // through the branded union, while binary subtraction stays plain numbers.
  return BucksDeltaSchema.parse(0 - value);
}
