import {
  WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS,
  WEEKLY_PARLAY_MIN_HISTORY_WINDOWS,
  WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS,
  WEEKLY_PARLAY_TARGET_YES_PROBABILITY_BPS,
  type WeeklyParlayContributionSnapshot,
  type WeeklyParlayDefinitionCriteria,
  type WeeklyParlayLeg,
  type WeeklyParlayLegShape,
  type WeeklyParlayProposal,
} from "#src/betting/weekly-parlay-criteria.ts";
import {
  evaluateWeeklyParlay,
  weeklyParlayLegValue,
} from "#src/betting/weekly-parlay-evaluator.ts";

const MAX_THRESHOLD_CANDIDATES_PER_LEG = 7;

export type WeeklyParlayReplayWindow = {
  periodKey: string;
  contributions: WeeklyParlayContributionSnapshot[];
};

export type WeeklyParlayPricing = {
  criteria: WeeklyParlayDefinitionCriteria;
  yesProbabilityBps: number;
  yesWindows: number;
  sampleSize: number;
  periodKeys: string[];
};

function stableThresholdCandidates(values: readonly number[]): number[] {
  const unique = [...new Set(values)].toSorted((left, right) => left - right);
  if (unique.length <= MAX_THRESHOLD_CANDIDATES_PER_LEG) {
    return unique;
  }
  return [
    ...new Set(
      Array.from({ length: MAX_THRESHOLD_CANDIDATES_PER_LEG }, (_, index) => {
        const position = Math.round(
          (index * (unique.length - 1)) /
            (MAX_THRESHOLD_CANDIDATES_PER_LEG - 1),
        );
        const value = unique[position];
        if (value === undefined) {
          throw new Error("Threshold candidate selection exceeded its input.");
        }
        return value;
      }),
    ),
  ];
}

function legWithThreshold(
  shape: WeeklyParlayLegShape,
  threshold: number,
): WeeklyParlayLeg {
  return { ...shape, threshold };
}

function thresholdCombinations(candidates: readonly number[][]): number[][] {
  let combinations: number[][] = [[]];
  for (const legCandidates of candidates) {
    combinations = combinations.flatMap((combination) =>
      legCandidates.map((candidate) => [...combination, candidate]),
    );
  }
  return combinations;
}

function thresholdTieKey(thresholds: readonly number[]): string {
  return thresholds
    .map((threshold) => threshold.toString().padStart(12, "0"))
    .join(":");
}

export function priceWeeklyParlay(input: {
  proposal: WeeklyParlayProposal;
  windows: readonly WeeklyParlayReplayWindow[];
}): WeeklyParlayPricing | undefined {
  if (input.windows.length < WEEKLY_PARLAY_MIN_HISTORY_WINDOWS) {
    return;
  }
  const candidates = input.proposal.legs.map((leg) =>
    stableThresholdCandidates(
      input.windows.map((window) =>
        weeklyParlayLegValue(leg, window.contributions),
      ),
    ).filter(
      (threshold) =>
        !(
          leg.kind === "aggregate" &&
          leg.metric === "games" &&
          leg.operator === "gte"
        ) || threshold > 0,
    ),
  );
  const priced = thresholdCombinations(candidates).flatMap((thresholds) => {
    const legs = input.proposal.legs.map((shape, index) => {
      const threshold = thresholds[index];
      if (threshold === undefined) {
        throw new Error("Missing deterministic threshold candidate.");
      }
      return legWithThreshold(shape, threshold);
    });
    const criteria: WeeklyParlayDefinitionCriteria = {
      version: input.proposal.version,
      legs,
    };
    const yesWindows = input.windows.filter(
      (window) =>
        evaluateWeeklyParlay(criteria, window.contributions).yesResult,
    ).length;
    const yesProbabilityBps = Math.round(
      (yesWindows * 10_000) / input.windows.length,
    );
    if (
      yesProbabilityBps < WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS ||
      yesProbabilityBps > WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS
    ) {
      return [];
    }
    return [
      {
        criteria,
        yesProbabilityBps,
        yesWindows,
        sampleSize: input.windows.length,
        periodKeys: input.windows.map((window) => window.periodKey),
        targetDistance: Math.abs(
          yesProbabilityBps - WEEKLY_PARLAY_TARGET_YES_PROBABILITY_BPS,
        ),
        tieKey: thresholdTieKey(thresholds),
      },
    ];
  });
  const selected = priced.toSorted(
    (left, right) =>
      left.targetDistance - right.targetDistance ||
      left.tieKey.localeCompare(right.tieKey),
  )[0];
  if (selected === undefined) {
    return;
  }
  return {
    criteria: selected.criteria,
    yesProbabilityBps: selected.yesProbabilityBps,
    yesWindows: selected.yesWindows,
    sampleSize: selected.sampleSize,
    periodKeys: selected.periodKeys,
  };
}
