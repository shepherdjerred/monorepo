import { z } from "zod";

/**
 * Branded Bryan Bucks money values.
 *
 * These brands answer one question — what does this quantity MEAN? — and
 * nothing else. Whether a value also fits the Prisma `Int` column it will
 * eventually be written to is a separate question, answered by the
 * `Storable*` schemas and helpers at the persistence edge in
 * `@scout-for-lol/data`.
 *
 * Fusing the two used to mean legal money could not be branded at all: a
 * pool aggregate sums many bettors' Int32 positions and may exceed Int32
 * while every contributing position is perfectly storable, so the aggregates
 * fell back to bare `number` and lost every guarantee the brands provide.
 * Splitting them lets `BucksPoolTotal` exist.
 *
 * - `BucksStake` — a positive whole-BB commitment (a submitted stake, a
 *   transfer total, a dare pot). Zero is not a stake.
 * - `BucksAmount` — a non-negative whole-BB quantity (a matched portion, a
 *   payout, a fee). Zero is a legitimate amount.
 * - `BucksDelta` — a signed, non-zero ledger movement. Negative debits,
 *   positive credits; a zero delta is a bug, never a no-op.
 * - `BucksPoolTotal` — a non-negative sum across many positions. Bounded only
 *   by exact integer arithmetic, never by one position's storage column.
 *
 * `z.number().int()` already rejects anything outside the IEEE-754
 * safe-integer range, so every brand is a safe integer and the checked
 * helpers below cannot hand back a sum that silently lost precision.
 */

/** Any positive whole-BB stake. */
export const BucksStakeSchema = z
  .number()
  .int()
  .positive()
  .brand<"BucksStake">();
export type BucksStake = z.infer<typeof BucksStakeSchema>;

/** Any non-negative whole-BB quantity. */
export const BucksAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"BucksAmount">();
export type BucksAmount = z.infer<typeof BucksAmountSchema>;

/** A signed, non-zero whole-BB ledger movement. */
export const BucksDeltaSchema = z
  .number()
  .int()
  .refine((value) => value !== 0, {
    message: "A Bucks delta of zero is a bug, not a no-op",
  })
  .brand<"BucksDelta">();
export type BucksDelta = z.infer<typeof BucksDeltaSchema>;

/**
 * A non-negative aggregate over many positions.
 *
 * Deliberately NOT interchangeable with `BucksAmount`: an amount names one
 * account's money and is expected to reach a storage column, while a pool
 * total is a derived sum that may legally exceed what any single column
 * holds. Passing one where the other belongs is the mistake this brand exists
 * to catch.
 */
export const BucksPoolTotalSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"BucksPoolTotal">();
export type BucksPoolTotal = z.infer<typeof BucksPoolTotalSchema>;

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

/** Checked addition. Throws when the sum leaves the safe-integer domain. */
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
 * non-negative safe-integer domain. */
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

/**
 * Sum many per-account positions into a pool aggregate.
 *
 * The empty sum is zero, which is why callers with nothing to add pass an
 * empty iterable rather than reaching for a pre-branded constant. Throws only
 * if the total leaves the safe-integer domain — the point at which the sum
 * itself would stop being exact.
 */
export function sumToPoolTotal(values: Iterable<BucksAmount>): BucksPoolTotal {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return BucksPoolTotalSchema.parse(total);
}
