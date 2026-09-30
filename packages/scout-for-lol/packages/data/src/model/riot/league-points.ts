import { match, P } from "ts-pattern";
import { z } from "zod";
import {
  divisionToString,
  numberOfDivisions,
  type Division,
} from "#src/model/riot/division.ts";
import type { Rank } from "#src/model/riot/rank.ts";
import { TierSchema, type Tier } from "#src/model/riot/tier.ts";
import { startCase } from "#src/util.ts";

export type LeaguePoints = z.infer<typeof LeaguePointsSchema>;
export const LeaguePointsSchema = z.number().brand("League Points");

export const leaguePointsPerDivision = 100;

export function leaguePointsDelta(
  oldRank: Rank | undefined,
  newRank: Rank,
): LeaguePoints {
  return LeaguePointsSchema.parse(
    rankToLeaguePoints(newRank) - rankToLeaguePoints(oldRank),
  );
}

export function rankToLeaguePoints(rank: Rank | undefined): LeaguePoints {
  if (rank === undefined) {
    return LeaguePointsSchema.parse(0);
  }

  const divisionLp =
    (numberOfDivisions - rank.division) * leaguePointsPerDivision;
  const tierLp = tierToLeaguePoints(rank.tier);
  return LeaguePointsSchema.parse(divisionLp + tierLp + rank.lp);
}

export function tierToOrdinal(tier: Tier): number {
  return match(tier)
    .with("iron", () => 0)
    .with("bronze", () => 1)
    .with("silver", () => 2)
    .with("gold", () => 3)
    .with("platinum", () => 4)
    .with("emerald", () => 5)
    .with("diamond", () => 6)
    .with("master", () => 7)
    .with("grandmaster", () => 8)
    .with("challenger", () => 9)
    .exhaustive();
}

function tierToLeaguePoints(tier: Tier): LeaguePoints {
  const multiplier = tierToOrdinal(tier);
  return LeaguePointsSchema.parse(
    multiplier * numberOfDivisions * leaguePointsPerDivision,
  );
}

export function lpDiffToString(input: number): string {
  return match(input)
    .with(P.number.negative(), () => `${input.toLocaleString()} LP`)
    .with(0, () => "0 LP")
    .with(P.number.positive(), () => `+${input.toLocaleString()} LP`)
    .run();
}

const MASTER_PLUS = new Set<Tier>(["master", "grandmaster", "challenger"]);
const DIVISION_FLOORS: readonly Division[] = [4, 3, 2, 1];
/**
 * Master+ LP is unbounded, so a 400-LP stride would make Master 400 occupy
 * the same number as Grandmaster 0. Chart space keeps each Master+ tier in
 * its own band so the recorded tier stays visible.
 */
export const masterPlusChartStride = 10_000;

function floorRank(tier: Tier, division: Division): Rank {
  return { tier, division, lp: 0, wins: 0, losses: 0 };
}

/**
 * Numeric Y for a rank-history chart. Iron through Diamond reuse the
 * competition ladder. Master+ uses {@link masterPlusChartStride} so a high
 * Master LP cannot be drawn or labeled as Grandmaster or Challenger.
 */
export function rankToChartPoints(rank: Rank): number {
  if (!MASTER_PLUS.has(rank.tier)) {
    return rankToLeaguePoints(rank);
  }
  const masterFloor = rankToLeaguePoints(floorRank("master", 1));
  const offset =
    (tierToOrdinal(rank.tier) - tierToOrdinal("master")) *
    masterPlusChartStride;
  return masterFloor + offset + rank.lp;
}

/**
 * Division-floor ladder ticks for a rank axis. Master+ has no divisions, so
 * each of those tiers is a single tick at 0 LP in chart space.
 */
export function rankLadderAxisTicks(): {
  leaguePoints: number;
  label: string;
}[] {
  const ticks: { leaguePoints: number; label: string }[] = [];
  for (const tier of TierSchema.options) {
    if (MASTER_PLUS.has(tier)) {
      ticks.push({
        leaguePoints: rankToChartPoints(floorRank(tier, 1)),
        label: startCase(tier),
      });
      continue;
    }
    for (const division of DIVISION_FLOORS) {
      ticks.push({
        leaguePoints: rankToChartPoints(floorRank(tier, division)),
        label: `${startCase(tier)} ${divisionToString(division)}`,
      });
    }
  }
  return ticks;
}

export function leaguePointsToRankLabel(leaguePoints: number): string {
  const ticks = rankLadderAxisTicks();
  const first = ticks[0];
  if (first === undefined) {
    throw new Error("Rank ladder has no axis ticks");
  }
  let chosen = first;
  for (const tick of ticks) {
    if (tick.leaguePoints <= leaguePoints) {
      chosen = tick;
    }
  }
  return chosen.label;
}
