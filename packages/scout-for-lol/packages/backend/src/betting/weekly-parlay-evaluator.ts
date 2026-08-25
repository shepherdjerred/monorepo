import type {
  WeeklyParlayAnyLegShape,
  WeeklyParlayContributionSnapshot,
  WeeklyParlayDefinitionCriteria,
  WeeklyParlayLeg,
} from "#src/betting/weekly-parlay-criteria.ts";
import { WeeklyParlayDefinitionCriteriaSchema } from "#src/betting/weekly-parlay-criteria.ts";

export type WeeklyParlayLegResult = {
  leg: WeeklyParlayLeg;
  current: number;
  passed: boolean;
  irreversiblyPassed: boolean;
};

export type WeeklyParlayEvaluation = {
  legs: WeeklyParlayLegResult[];
  qualification: {
    minimumGamesPerSubject: number;
    subjects: {
      subject: string;
      games: number;
      passed: boolean;
    }[];
    passed: boolean;
  };
  yesResult: boolean;
  irreversiblyYes: boolean;
};

function numericComparison(
  value: number,
  operator: WeeklyParlayLeg["operator"],
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

function sum(
  contributions: readonly WeeklyParlayContributionSnapshot[],
  value: (contribution: WeeklyParlayContributionSnapshot) => number,
): number {
  return contributions.reduce(
    (total, contribution) => total + value(contribution),
    0,
  );
}

function maximum(
  contributions: readonly WeeklyParlayContributionSnapshot[],
  value: (contribution: WeeklyParlayContributionSnapshot) => number,
): number {
  return contributions.reduce(
    (current, contribution) => Math.max(current, value(contribution)),
    0,
  );
}

function longestWinStreak(
  contributions: readonly WeeklyParlayContributionSnapshot[],
): number {
  const ordered = contributions.toSorted((left, right) =>
    left.completedAt.localeCompare(right.completedAt),
  );
  let current = 0;
  let longest = 0;
  for (const contribution of ordered) {
    current = contribution.win ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function aggregateValue(
  leg: Extract<WeeklyParlayAnyLegShape, { kind: "aggregate" }>,
  contributions: readonly WeeklyParlayContributionSnapshot[],
): number {
  switch (leg.metric) {
    case "games":
      return contributions.length;
    case "wins":
      return contributions.filter((contribution) => contribution.win).length;
    case "kills":
      return sum(contributions, (contribution) => contribution.kills);
    case "deaths":
      return sum(contributions, (contribution) => contribution.deaths);
    case "assists":
      return sum(contributions, (contribution) => contribution.assists);
    case "champion_damage":
      return sum(contributions, (contribution) => contribution.championDamage);
    case "creep_score":
      return sum(contributions, (contribution) => contribution.creepScore);
    case "gold":
      return sum(contributions, (contribution) => contribution.gold);
    case "vision_score":
      return sum(contributions, (contribution) => contribution.visionScore);
    case "time_played":
      return sum(contributions, (contribution) => contribution.timePlayed);
    case "distinct_champions":
      return new Set(contributions.map((contribution) => contribution.champion))
        .size;
    case "distinct_roles":
      return new Set(contributions.map((contribution) => contribution.role))
        .size;
    case "longest_win_streak":
      return longestWinStreak(contributions);
    case "best_game_kills":
      return maximum(contributions, (contribution) => contribution.kills);
    case "best_game_assists":
      return maximum(contributions, (contribution) => contribution.assists);
    case "best_game_damage":
      return maximum(
        contributions,
        (contribution) => contribution.championDamage,
      );
  }
}

function average(total: number, count: number): number {
  return count === 0 ? 0 : Math.round(total / count);
}

function rateValue(
  leg: Extract<WeeklyParlayAnyLegShape, { kind: "rate" }>,
  contributions: readonly WeeklyParlayContributionSnapshot[],
): number {
  const games = contributions.length;
  switch (leg.metric) {
    case "win_rate_bps":
      return games === 0
        ? 0
        : Math.round(
            (contributions.filter((contribution) => contribution.win).length *
              10_000) /
              games,
          );
    case "average_kills_x100":
      return average(
        sum(contributions, (contribution) => contribution.kills) * 100,
        games,
      );
    case "average_deaths_x100":
      return average(
        sum(contributions, (contribution) => contribution.deaths) * 100,
        games,
      );
    case "average_assists_x100":
      return average(
        sum(contributions, (contribution) => contribution.assists) * 100,
        games,
      );
    case "average_kda_x100": {
      const killsAndAssists = sum(
        contributions,
        (contribution) => contribution.kills + contribution.assists,
      );
      const deaths = sum(contributions, (contribution) => contribution.deaths);
      return games === 0
        ? 0
        : Math.round((killsAndAssists * 100) / Math.max(1, deaths));
    }
    case "average_champion_damage":
      return average(
        sum(contributions, (contribution) => contribution.championDamage),
        games,
      );
    case "average_vision_score_x100":
      return average(
        sum(contributions, (contribution) => contribution.visionScore) * 100,
        games,
      );
  }
}

export function weeklyParlayLegValue(
  leg: WeeklyParlayAnyLegShape,
  allContributions: readonly WeeklyParlayContributionSnapshot[],
): number {
  const contributions = allContributions.filter(
    (contribution) => contribution.subject === leg.subject,
  );
  switch (leg.kind) {
    case "aggregate":
      return aggregateValue(leg, contributions);
    case "rate":
      return rateValue(leg, contributions);
    case "champion_games":
      return contributions.filter(
        (contribution) =>
          contribution.champion === leg.champion &&
          (!leg.winsOnly || contribution.win),
      ).length;
    case "role_games":
      return contributions.filter(
        (contribution) =>
          contribution.role === leg.role && (!leg.winsOnly || contribution.win),
      ).length;
    case "champion_peak": {
      const championContributions = contributions.filter(
        (contribution) => contribution.champion === leg.champion,
      );
      switch (leg.metric) {
        case "kills":
          return maximum(
            championContributions,
            (contribution) => contribution.kills,
          );
        case "assists":
          return maximum(
            championContributions,
            (contribution) => contribution.assists,
          );
        case "champion_damage":
          return maximum(
            championContributions,
            (contribution) => contribution.championDamage,
          );
        case "vision_score":
          return maximum(
            championContributions,
            (contribution) => contribution.visionScore,
          );
      }
    }
  }
}

function isMonotonicGte(leg: WeeklyParlayLeg): boolean {
  return leg.operator === "gte" && leg.kind !== "rate";
}

export function evaluateWeeklyParlay(
  criteriaInput: WeeklyParlayDefinitionCriteria,
  contributions: readonly WeeklyParlayContributionSnapshot[],
): WeeklyParlayEvaluation {
  const criteria = WeeklyParlayDefinitionCriteriaSchema.parse(criteriaInput);
  const legs = criteria.legs.map((leg) => {
    const current = weeklyParlayLegValue(leg, contributions);
    const passed = numericComparison(current, leg.operator, leg.threshold);
    return {
      leg,
      current,
      passed,
      irreversiblyPassed: passed && isMonotonicGte(leg),
    };
  });
  const minimumGamesPerSubject =
    criteria.version === 1 ? 0 : criteria.qualification.minimumGamesPerSubject;
  const subjects = [...new Set(criteria.legs.map((leg) => leg.subject))]
    .toSorted((left, right) => left.localeCompare(right))
    .map((subject) => {
      const games = contributions.filter(
        (contribution) => contribution.subject === subject,
      ).length;
      return {
        subject,
        games,
        passed: games >= minimumGamesPerSubject,
      };
    });
  const qualification = {
    minimumGamesPerSubject,
    subjects,
    passed: subjects.every((subject) => subject.passed),
  };
  return {
    legs,
    qualification,
    yesResult: qualification.passed && legs.every((leg) => leg.passed),
    irreversiblyYes:
      qualification.passed && legs.every((leg) => leg.irreversiblyPassed),
  };
}
