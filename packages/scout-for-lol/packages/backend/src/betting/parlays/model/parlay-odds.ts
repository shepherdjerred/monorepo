import {
  BucksParlaySideSchema,
  StorableBucksAmountSchema,
  StorableBucksStakeSchema,
  type BucksParlaySide,
  type StorableBucksAmount,
  type StorableBucksStake,
} from "@scout-for-lol/data";
import { z } from "zod";

export const ParlayProbabilityBpsSchema = z.number().int().min(1000).max(9000);

/**
 * A quote is priced for storage, not just for arithmetic: the gross payout and
 * the house reserve both become Prisma `Int` columns, so the storable brands
 * are what this module produces. An unquotable position returns `undefined`
 * rather than throwing — placement turns that into a "storage limit" reply.
 */
export type ParlayQuote = {
  sideProbabilityBps: number;
  grossPayout: StorableBucksAmount;
  houseReserve: StorableBucksAmount;
};

function storableInt32(value: bigint): StorableBucksAmount | undefined {
  const parsed = StorableBucksAmountSchema.safeParse(Number(value));
  return parsed.success ? parsed.data : undefined;
}

export function probabilityForSide(
  yesProbabilityBps: number,
  side: BucksParlaySide,
): number {
  const yes = ParlayProbabilityBpsSchema.parse(yesProbabilityBps);
  return BucksParlaySideSchema.parse(side) === "YES" ? yes : 10_000 - yes;
}

/** Quote the entire position, not just its increment. Integer ceiling avoids
 * underpaying fractional BB and repricing total stake prevents repeated-small-
 * bet rounding advantages. */
export function quoteParlayPosition(input: {
  totalStake: StorableBucksStake;
  yesProbabilityBps: number;
  side: BucksParlaySide;
}): ParlayQuote | undefined {
  const sideProbabilityBps = probabilityForSide(
    input.yesProbabilityBps,
    input.side,
  );
  const numerator = BigInt(input.totalStake) * 10_000n;
  const denominator = BigInt(sideProbabilityBps);
  const gross = (numerator + denominator - 1n) / denominator;
  const reserve = gross - BigInt(input.totalStake);
  const grossPayout = storableInt32(gross);
  const houseReserve = storableInt32(reserve);
  if (grossPayout === undefined || houseReserve === undefined) return;
  return { sideProbabilityBps, grossPayout, houseReserve };
}

/** Grow a stored position by a new stake, refusing a total the `Int` column
 * could not hold. Both inputs are already whole Bucks; the bigint keeps the
 * sum exact while it is being checked. */
export function addInt32(
  left: number,
  right: number,
): StorableBucksStake | undefined {
  const parsed = StorableBucksStakeSchema.safeParse(
    Number(BigInt(left) + BigInt(right)),
  );
  return parsed.success ? parsed.data : undefined;
}

export function formatDecimalOdds(probabilityBps: number): string {
  return (10_000 / probabilityBps).toFixed(2);
}
