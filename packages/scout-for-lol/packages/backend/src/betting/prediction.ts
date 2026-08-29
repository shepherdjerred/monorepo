import {
  BucksPredictionSchema,
  type BucksPredictionFeature,
  type BucksPredictionQuality,
  type BucksPredictionV2,
  type QueueType,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { BLUE_TEAM_ID, RED_TEAM_ID } from "#src/betting/constants.ts";

/**
 * Deterministic v2 pregame estimate.
 *
 * Every feature is frozen before the match result exists. The function is
 * deliberately pure: callers can replay and score the same observation later,
 * and swapping the teams must yield the complementary probability.
 */

const LP_PER_TIER = 400;
const B_RANK = 0.55;
const B_SEASON = 3;
const B_RECENT = 1.2;
const B_LANE = 0.6;
const B_CHAMPION = 0.8;

const MAX_RANK_Z = 1.5;
const MAX_RATE_DELTA = 0.25;
const MIN_RANKED_FOR_RANK_TERM = 4;
const MIN_PROBABILITY = 0.05;
const MAX_PROBABILITY = 0.95;
const COIN_FLIP_BAND = 0.05;

const RECENT_COVERAGE_GAMES = 5;
const SPECIALIST_COVERAGE_GAMES = 3;

type Term = {
  name: string;
  contribution: number;
  description: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const upper = sorted[midpoint];
  if (upper === undefined) {
    throw new Error("A non-empty rank sample must have a midpoint");
  }
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[midpoint - 1];
  if (lower === undefined) {
    throw new Error("An even rank sample must have two midpoint values");
  }
  return (lower + upper) / 2;
}

function teamMean(
  features: readonly BucksPredictionFeature[],
  teamId: RiotTeamId,
  value: (feature: BucksPredictionFeature) => number,
): number {
  return mean(
    features
      .filter((feature) => feature.teamId === teamId)
      .map((feature) => value(feature)),
  );
}

function sideDescription(contribution: number, label: string): string {
  return `${contribution >= 0 ? "Blue" : "Red"} ${label}`;
}

function rankTerm(
  features: readonly BucksPredictionFeature[],
): Term | undefined {
  const rankedLp = features.flatMap((feature) =>
    feature.rankLeaguePoints === null ? [] : [feature.rankLeaguePoints],
  );
  if (rankedLp.length < MIN_RANKED_FOR_RANK_TERM) {
    return undefined;
  }

  const imputed = median(rankedLp);
  const lp = (feature: BucksPredictionFeature) =>
    feature.rankLeaguePoints ?? imputed;
  const delta =
    teamMean(features, BLUE_TEAM_ID, lp) - teamMean(features, RED_TEAM_ID, lp);
  const contribution =
    B_RANK * clamp(delta / LP_PER_TIER, -MAX_RANK_Z, MAX_RANK_Z);
  return {
    name: "rank",
    contribution,
    description: sideDescription(contribution, "rank edge"),
  };
}

function shrunkRate(wins: number, games: number, prior: number): number {
  return (wins + prior) / (games + prior * 2);
}

function rateTerm(input: {
  features: readonly BucksPredictionFeature[];
  name: string;
  label: string;
  coefficient: number;
  rate: (feature: BucksPredictionFeature) => number;
}): Term {
  const delta = clamp(
    teamMean(input.features, BLUE_TEAM_ID, input.rate) -
      teamMean(input.features, RED_TEAM_ID, input.rate),
    -MAX_RATE_DELTA,
    MAX_RATE_DELTA,
  );
  const contribution = input.coefficient * delta;
  return {
    name: input.name,
    contribution,
    description: sideDescription(contribution, input.label),
  };
}

function seasonRate(feature: BucksPredictionFeature): number {
  if (feature.seasonWins === null || feature.seasonLosses === null) {
    return 0.5;
  }
  return shrunkRate(
    feature.seasonWins,
    feature.seasonWins + feature.seasonLosses,
    10,
  );
}

function qualityFor(input: {
  features: readonly BucksPredictionFeature[];
  queueType: QueueType;
}): {
  dataQuality: BucksPredictionQuality;
  covered: number;
  applicable: number;
} {
  const ranksApply =
    input.queueType === "solo" ||
    input.queueType === "flex" ||
    input.queueType === "ranked 5s";
  const applicablePerPlayer = ranksApply ? 5 : 3;
  const applicable = input.features.length * applicablePerPlayer;
  const covered = input.features.reduce((total, feature) => {
    const rankCoverage =
      ranksApply && feature.rankLeaguePoints !== null ? 2 : 0;
    const recentCoverage =
      feature.recentForm.games >= RECENT_COVERAGE_GAMES ? 1 : 0;
    const laneCoverage =
      feature.laneForm.games >= SPECIALIST_COVERAGE_GAMES ? 1 : 0;
    const championCoverage =
      feature.championForm.games >= SPECIALIST_COVERAGE_GAMES ? 1 : 0;
    return (
      total + rankCoverage + recentCoverage + laneCoverage + championCoverage
    );
  }, 0);
  const ratio = covered / applicable;
  const dataQuality: BucksPredictionQuality =
    ratio >= 0.8 ? "high" : ratio >= 0.5 ? "medium" : "low";
  return { dataQuality, covered, applicable };
}

export function predictWin(input: {
  features: readonly BucksPredictionFeature[];
  queueType: QueueType;
}): BucksPredictionV2 {
  if (input.features.length !== 10) {
    throw new Error("A standard prediction requires exactly ten participants");
  }

  const rank = rankTerm(input.features);
  const terms: Term[] = [
    ...(rank === undefined ? [] : [rank]),
    rateTerm({
      features: input.features,
      name: "season",
      label: "season record",
      coefficient: B_SEASON,
      rate: seasonRate,
    }),
    rateTerm({
      features: input.features,
      name: "recent",
      label: "recent-form edge",
      coefficient: B_RECENT,
      rate: (feature) =>
        shrunkRate(feature.recentForm.wins, feature.recentForm.games, 5),
    }),
    rateTerm({
      features: input.features,
      name: "lane",
      label: "lane-form edge",
      coefficient: B_LANE,
      rate: (feature) =>
        shrunkRate(feature.laneForm.wins, feature.laneForm.games, 3),
    }),
    rateTerm({
      features: input.features,
      name: "champion",
      label: "champion-form edge",
      coefficient: B_CHAMPION,
      rate: (feature) =>
        shrunkRate(feature.championForm.wins, feature.championForm.games, 3),
    }),
  ];

  const logit = terms.reduce((total, term) => total + term.contribution, 0);
  const blueWinProbability = clamp(
    1 / (1 + Math.exp(-logit)),
    MIN_PROBABILITY,
    MAX_PROBABILITY,
  );
  const quality = qualityFor(input);
  const drivers = [...terms]
    .filter((term) => term.contribution !== 0)
    .sort(
      (left, right) =>
        Math.abs(right.contribution) - Math.abs(left.contribution),
    )
    .slice(0, 2)
    .map((term) => term.description);

  return {
    version: 2,
    blueWinProbability,
    dataQuality: quality.dataQuality,
    coverage: {
      covered: quality.covered,
      applicable: quality.applicable,
    },
    drivers,
  };
}

/**
 * The settlement-time reveal sentence for a pool's stored estimate, or nothing
 * when the stored call was inside the near-even suppression band.
 */
export function formatStoredPrediction(raw: string | null): string | undefined {
  if (raw === null) {
    return undefined;
  }
  const parsed = BucksPredictionSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return undefined;
  }
  if (!("version" in parsed.data)) {
    return shouldDisplayPrediction(parsed.data.winProbability)
      ? parsed.data.sentence
      : undefined;
  }
  if (!shouldDisplayPrediction(parsed.data.blueWinProbability)) {
    return undefined;
  }
  const blue = Math.round(parsed.data.blueWinProbability * 100);
  return `🔮 Scout's experimental estimate was Blue ${blue.toString()}% / Red ${(100 - blue).toString()}% · ${parsed.data.dataQuality} data quality.`;
}

export function shouldDisplayPrediction(winProbability: number): boolean {
  return Math.abs(Math.round(winProbability * 100) - 50) > COIN_FLIP_BAND * 100;
}

export function opposingTeam(teamId: RiotTeamId): RiotTeamId {
  return teamId === BLUE_TEAM_ID ? RED_TEAM_ID : BLUE_TEAM_ID;
}
