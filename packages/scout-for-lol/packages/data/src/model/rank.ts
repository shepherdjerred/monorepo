import { z } from "zod";
import {
  DivisionSchema,
  divisionToString,
} from "@scout-for-lol/data/model/division.ts";
import { TierSchema, type Tier } from "@scout-for-lol/data/model/tier.ts";
import {
  rankToLeaguePoints,
  tierToOrdinal,
} from "@scout-for-lol/data/model/league-points.ts";
import { startCase } from "@scout-for-lol/data/util.ts";

export type Rank = z.infer<typeof RankSchema>;
export const RankSchema = z.strictObject({
  division: DivisionSchema,
  tier: TierSchema,
  lp: z.number().nonnegative(), // No max - Master+ can have LP > 100
  wins: z.number().nonnegative(),
  losses: z.number().nonnegative(),
});

export type Ranks = z.infer<typeof RanksSchema>;
export const RanksSchema = z.strictObject({
  solo: RankSchema.optional(),
  flex: RankSchema.optional(),
});

export function rankToString(rank: Rank): string {
  return `${startCase(rank.tier)} ${divisionToString(rank.division)}, ${rank.lp.toString()}LP`;
}

export function rankToSimpleString(rank: Rank): string {
  return `${startCase(rank.tier)} ${divisionToString(rank.division)}`;
}

export function wasDemoted(previous: Rank | undefined, current: Rank): boolean {
  if (previous == undefined) {
    return false;
  }

  const previousTier = tierToOrdinal(previous.tier);
  const currentTier = tierToOrdinal(current.tier);
  const previousDivision = previous.division;
  const currentDivision = current.division;

  if (previousTier > currentTier) {
    return true;
  }

  if (previousTier == currentTier && previousDivision < currentDivision) {
    return true;
  }

  return false;
}

export function wasPromoted(
  previous: Rank | undefined,
  current: Rank,
): boolean {
  if (previous === undefined) {
    return false;
  }

  const previousTier = tierToOrdinal(previous.tier);
  const currentTier = tierToOrdinal(current.tier);
  const previousDivision = previous.division;
  const currentDivision = current.division;

  if (previousTier < currentTier) {
    return true;
  }

  if (previousTier == currentTier && previousDivision > currentDivision) {
    return true;
  }

  return false;
}

export function getLeaguePointsDelta(oldRank: Rank, newRank: Rank): number {
  return rankToLeaguePoints(newRank) - rankToLeaguePoints(oldRank);
}

/**
 * Approximate rank distribution percentiles for League of Legends.
 * These represent the "top X%" of players at each tier.
 * Data is approximate and based on typical ranked distributions.
 */
const TIER_PERCENTILES: Record<Tier, number> = {
  iron: 96,
  bronze: 75,
  silver: 50,
  gold: 32,
  platinum: 18,
  emerald: 8,
  diamond: 3,
  master: 0.5,
  grandmaster: 0.04,
  challenger: 0.01,
};

/**
 * Get the approximate percentile for a tier (top X% of players).
 * @param tier - The tier to get percentile for
 * @returns The approximate top percentile (e.g., 32 means "top 32%")
 */
export function tierToPercentile(tier: Tier): number {
  return TIER_PERCENTILES[tier];
}

/**
 * Format the percentile as a human-readable string.
 * @param tier - The tier to format
 * @returns A formatted string like "top 32%" or "top 0.5%"
 */
export function tierToPercentileString(tier: Tier): string {
  const percentile = TIER_PERCENTILES[tier];
  return `top ${percentile.toString()}%`;
}
