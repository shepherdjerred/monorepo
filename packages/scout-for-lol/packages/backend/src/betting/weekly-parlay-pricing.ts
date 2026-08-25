import {
  WEEKLY_PARLAY_MAX_LEG_PROBABILITY_BPS,
  WEEKLY_PARLAY_MAX_RECENT_YES_PROBABILITY_BPS,
  WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS,
  WEEKLY_PARLAY_MIN_HISTORY_WINDOWS,
  WEEKLY_PARLAY_MIN_LEG_PROBABILITY_BPS,
  WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS,
  WEEKLY_PARLAY_RECENT_QUALIFIED_WINDOWS,
  WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES,
  WEEKLY_PARLAY_TARGET_YES_PROBABILITY_BPS,
  type WeeklyParlayContributionSnapshot,
  type WeeklyParlayCurrentDefinitionCriteria,
  type WeeklyParlayCurrentLeg,
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
  proposal: WeeklyParlayProposal;
  criteria: WeeklyParlayCurrentDefinitionCriteria;
  yesProbabilityBps: number;
  yesWindows: number;
  totalWindows: number;
  qualifiedWindows: number;
  excludedWindows: number;
  qualifiedPeriodKeys: string[];
  excludedPeriodKeys: string[];
  recentQualifiedWindows: number;
  recentYesWindows: number;
  recentYesProbabilityBps: number;
  legEvidence: {
    leg: WeeklyParlayCurrentLeg;
    yesWindows: number;
    probabilityBps: number;
  }[];
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

function comparisonPassed(
  value: number,
  operator: WeeklyParlayLegShape["operator"],
  threshold: number,
): boolean {
  switch (operator) {
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
  }
}

function probabilityBps(hits: number, sampleSize: number): number {
  return Math.round((hits * 10_000) / sampleSize);
}

function legWithThreshold(
  shape: WeeklyParlayLegShape,
  threshold: number,
): WeeklyParlayCurrentLeg {
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

function qualifiedWindow(
  proposal: WeeklyParlayProposal,
  window: WeeklyParlayReplayWindow,
): boolean {
  const subjects = new Set(proposal.legs.map((leg) => leg.subject));
  return [...subjects].every(
    (subject) =>
      window.contributions.filter(
        (contribution) => contribution.subject === subject,
      ).length >= WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES,
  );
}

export function priceWeeklyParlay(input: {
  proposal: WeeklyParlayProposal;
  windows: readonly WeeklyParlayReplayWindow[];
}): WeeklyParlayPricing | undefined {
  const qualified = input.windows.filter((window) =>
    qualifiedWindow(input.proposal, window),
  );
  if (qualified.length < WEEKLY_PARLAY_MIN_HISTORY_WINDOWS) {
    return;
  }
  const excluded = input.windows.filter(
    (window) => !qualifiedWindow(input.proposal, window),
  );
  const legValues = input.proposal.legs.map((leg) =>
    qualified.map((window) => weeklyParlayLegValue(leg, window.contributions)),
  );
  const candidates = input.proposal.legs.map((leg, legIndex) => {
    const values = legValues[legIndex];
    if (values === undefined) {
      throw new Error("Missing weekly parlay leg history values.");
    }
    return stableThresholdCandidates(values).filter((threshold) => {
      const hits = values.filter((value) =>
        comparisonPassed(value, leg.operator, threshold),
      ).length;
      const probability = probabilityBps(hits, qualified.length);
      return (
        probability >= WEEKLY_PARLAY_MIN_LEG_PROBABILITY_BPS &&
        probability <= WEEKLY_PARLAY_MAX_LEG_PROBABILITY_BPS
      );
    });
  });
  if (candidates.some((legCandidates) => legCandidates.length === 0)) {
    return;
  }
  const recent = qualified.slice(-WEEKLY_PARLAY_RECENT_QUALIFIED_WINDOWS);
  const priced = thresholdCombinations(candidates).flatMap((thresholds) => {
    const legs = input.proposal.legs.map((shape, index) => {
      const threshold = thresholds[index];
      if (threshold === undefined) {
        throw new Error("Missing deterministic threshold candidate.");
      }
      return legWithThreshold(shape, threshold);
    });
    const criteria: WeeklyParlayCurrentDefinitionCriteria = {
      version: input.proposal.version,
      qualification: {
        minimumGamesPerSubject: WEEKLY_PARLAY_SETTLEMENT_MIN_GAMES,
      },
      legs,
    };
    const evaluations = qualified.map((window) =>
      evaluateWeeklyParlay(criteria, window.contributions),
    );
    const yesWindows = evaluations.filter(
      (evaluation) => evaluation.yesResult,
    ).length;
    const yesProbabilityBps = probabilityBps(yesWindows, qualified.length);
    if (
      yesProbabilityBps < WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS ||
      yesProbabilityBps > WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS
    ) {
      return [];
    }
    const recentYesWindows = recent.filter(
      (window) =>
        evaluateWeeklyParlay(criteria, window.contributions).yesResult,
    ).length;
    const recentYesProbabilityBps = probabilityBps(
      recentYesWindows,
      recent.length,
    );
    if (
      recentYesWindows === 0 ||
      recentYesProbabilityBps > WEEKLY_PARLAY_MAX_RECENT_YES_PROBABILITY_BPS
    ) {
      return [];
    }
    const legEvidence = legs.map((leg, index) => {
      const yesWindowsForLeg = evaluations.filter(
        (evaluation) => evaluation.legs[index]?.passed === true,
      ).length;
      return {
        leg,
        yesWindows: yesWindowsForLeg,
        probabilityBps: probabilityBps(yesWindowsForLeg, qualified.length),
      };
    });
    return [
      {
        proposal: input.proposal,
        criteria,
        yesProbabilityBps,
        yesWindows,
        totalWindows: input.windows.length,
        qualifiedWindows: qualified.length,
        excludedWindows: excluded.length,
        qualifiedPeriodKeys: qualified.map((window) => window.periodKey),
        excludedPeriodKeys: excluded.map((window) => window.periodKey),
        recentQualifiedWindows: recent.length,
        recentYesWindows,
        recentYesProbabilityBps,
        legEvidence,
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
  const {
    targetDistance: _targetDistance,
    tieKey: _tieKey,
    ...result
  } = selected;
  return result;
}

export function priceWeeklyParlayProposals(input: {
  proposals: readonly WeeklyParlayProposal[];
  windows: readonly WeeklyParlayReplayWindow[];
}): WeeklyParlayPricing | undefined {
  return input.proposals
    .flatMap((proposal) => {
      const priced = priceWeeklyParlay({ proposal, windows: input.windows });
      return priced === undefined ? [] : [priced];
    })
    .toSorted(
      (left, right) =>
        Math.abs(
          left.yesProbabilityBps - WEEKLY_PARLAY_TARGET_YES_PROBABILITY_BPS,
        ) -
          Math.abs(
            right.yesProbabilityBps - WEEKLY_PARLAY_TARGET_YES_PROBABILITY_BPS,
          ) ||
        JSON.stringify(left.proposal).localeCompare(
          JSON.stringify(right.proposal),
        ) ||
        JSON.stringify(left.criteria).localeCompare(
          JSON.stringify(right.criteria),
        ),
    )[0];
}
