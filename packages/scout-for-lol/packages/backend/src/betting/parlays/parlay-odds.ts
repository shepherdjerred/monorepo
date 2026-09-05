import {
  BUCKS_INT32_MAX,
  BucksParlaySideSchema,
  BucksStakeSchema,
  type BucksParlaySide,
} from "@scout-for-lol/data";
import { z } from "zod";

export const ParlayProbabilityBpsSchema = z.number().int().min(1000).max(9000);

export type ParlayQuote = {
  sideProbabilityBps: number;
  grossPayout: number;
  houseReserve: number;
};

function int32(value: bigint): number | undefined {
  return value >= 0n && value <= BigInt(BUCKS_INT32_MAX)
    ? Number(value)
    : undefined;
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
  totalStake: number;
  yesProbabilityBps: number;
  side: BucksParlaySide;
}): ParlayQuote | undefined {
  const stake = BucksStakeSchema.safeParse(input.totalStake);
  if (!stake.success) return;
  const sideProbabilityBps = probabilityForSide(
    input.yesProbabilityBps,
    input.side,
  );
  const numerator = BigInt(stake.data) * 10_000n;
  const denominator = BigInt(sideProbabilityBps);
  const gross = (numerator + denominator - 1n) / denominator;
  const reserve = gross - BigInt(stake.data);
  const grossPayout = int32(gross);
  const houseReserve = int32(reserve);
  if (grossPayout === undefined || houseReserve === undefined) return;
  return { sideProbabilityBps, grossPayout, houseReserve };
}

export function addInt32(left: number, right: number): number | undefined {
  return int32(BigInt(left) + BigInt(right));
}

export function formatDecimalOdds(probabilityBps: number): string {
  return (10_000 / probabilityBps).toFixed(2);
}
