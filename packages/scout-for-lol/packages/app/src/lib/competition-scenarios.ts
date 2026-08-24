import { ChampionIdSchema, type SeasonData } from "@scout-for-lol/data";
import type { CriteriaState } from "#src/components/competition-criteria-fields.tsx";
import type { DatesState } from "#src/components/competition-dates-fields.tsx";
import {
  addCalendarDays,
  calendarDateInTimezone,
} from "#src/lib/competition-time.ts";

export type CompetitionScenarioValue = {
  title: string;
  description: string;
  criteria: CriteriaState;
  dates: DatesState;
};

export type CompetitionScenario = {
  id: string;
  label: string;
  description: string;
  value: CompetitionScenarioValue | null;
  unavailableReason?: string;
};

type ScenarioContext = {
  now: Date;
  timezone: string;
  seasons: SeasonData[];
};

const EMPTY_CRITERIA: CriteriaState = {
  criteriaType: "MOST_GAMES_PLAYED",
  queue: "SOLO",
  championId: "",
  minGames: "10",
};

function fixedDates(now: Date, timezone: string): DatesState {
  const startDate = calendarDateInTimezone(now, timezone);
  return {
    mode: "FIXED_DATES",
    startDate,
    endDate: addCalendarDays(startDate, 29),
    seasonId: "",
  };
}

function nearestSeason(
  seasons: SeasonData[],
  now: Date,
): SeasonData | undefined {
  return seasons
    .filter((season) => season.endDate >= now)
    .toSorted(
      (left, right) => left.startDate.getTime() - right.startDate.getTime(),
    )[0];
}

function rankedScenario(options: {
  id: string;
  label: string;
  description: string;
  title: string;
  criteriaType: "HIGHEST_RANK" | "MOST_RANK_CLIMB";
  queue: "SOLO" | "FLEX";
  season: SeasonData | undefined;
}): CompetitionScenario {
  if (options.season === undefined) {
    return {
      id: options.id,
      label: options.label,
      description: options.description,
      value: null,
      unavailableReason: "No current or upcoming League season is available.",
    };
  }
  return {
    id: options.id,
    label: options.label,
    description: options.description,
    value: {
      title: options.title,
      description: options.description,
      criteria: {
        ...EMPTY_CRITERIA,
        criteriaType: options.criteriaType,
        queue: options.queue,
      },
      dates: {
        mode: "SEASON",
        startDate: "",
        endDate: "",
        seasonId: options.season.id,
      },
    },
  };
}

function rollingScenario(options: {
  id: string;
  label: string;
  description: string;
  title: string;
  criteria: CriteriaState;
  dates: DatesState;
}): CompetitionScenario {
  return {
    id: options.id,
    label: options.label,
    description: options.description,
    value: {
      title: options.title,
      description: options.description,
      criteria: options.criteria,
      dates: options.dates,
    },
  };
}

export function buildCompetitionScenarios(
  context: ScenarioContext,
): CompetitionScenario[] {
  const season = nearestSeason(context.seasons, context.now);
  const dates = fixedDates(context.now, context.timezone);
  return [
    {
      id: "blank",
      label: "Blank",
      description: "Start with empty basics and choose every setting yourself.",
      value: {
        title: "",
        description: "",
        criteria: EMPTY_CRITERIA,
        dates: {
          mode: "FIXED_DATES",
          startDate: "",
          endDate: "",
          seasonId: "",
        },
      },
    },
    rankedScenario({
      id: "solo-rank-climb",
      label: "Solo rank climb",
      title: "Biggest Solo Queue climb this season",
      description: "Gain the most Solo Queue LP before the season ends.",
      criteriaType: "MOST_RANK_CLIMB",
      queue: "SOLO",
      season,
    }),
    rankedScenario({
      id: "flex-rank-climb",
      label: "Flex rank climb",
      title: "Biggest Flex Queue climb this season",
      description: "Gain the most Flex Queue LP before the season ends.",
      criteriaType: "MOST_RANK_CLIMB",
      queue: "FLEX",
      season,
    }),
    rankedScenario({
      id: "rank",
      label: "Highest Solo rank",
      title: "Highest Solo Queue rank this season",
      description: "Reach the highest Solo Queue rank before the season ends.",
      criteriaType: "HIGHEST_RANK",
      queue: "SOLO",
      season,
    }),
    rankedScenario({
      id: "highest-flex-rank",
      label: "Highest Flex rank",
      title: "Highest Flex Queue rank this season",
      description: "Reach the highest Flex Queue rank before the season ends.",
      criteriaType: "HIGHEST_RANK",
      queue: "FLEX",
      season,
    }),
    rollingScenario({
      id: "games-sprint",
      label: "All-queue activity",
      title: "Most games — 30-day sprint",
      description: "Play the most games across every queue over 30 days.",
      criteria: { ...EMPTY_CRITERIA, queue: "ALL" },
      dates,
    }),
    rollingScenario({
      id: "solo-games",
      label: "Solo activity",
      title: "Most Solo Queue games — 30-day sprint",
      description: "Play the most Solo Queue games over 30 days.",
      criteria: EMPTY_CRITERIA,
      dates,
    }),
    rollingScenario({
      id: "aram-games",
      label: "ARAM activity",
      title: "Most ARAM games — 30-day sprint",
      description: "Play the most ARAM games over 30 days.",
      criteria: { ...EMPTY_CRITERIA, queue: "ARAM" },
      dates,
    }),
    rollingScenario({
      id: "solo-wins",
      label: "Solo wins",
      title: "Most Solo Queue wins — 30-day sprint",
      description: "Win the most Solo Queue games over 30 days.",
      criteria: {
        ...EMPTY_CRITERIA,
        criteriaType: "MOST_WINS_PLAYER",
      },
      dates,
    }),
    rollingScenario({
      id: "yuumi",
      label: "Champion wins",
      title: "Most wins on Yuumi",
      description: "Earn the most wins on one champion over 30 days.",
      criteria: {
        ...EMPTY_CRITERIA,
        criteriaType: "MOST_WINS_CHAMPION",
        queue: "__ANY__",
        championId: ChampionIdSchema.parse(350).toString(),
      },
      dates,
    }),
    rollingScenario({
      id: "solo-win-rate",
      label: "Solo win rate",
      title: "Best Solo Queue win rate — 30 days",
      description: "Finish with the best Solo Queue win rate after 10 games.",
      criteria: {
        ...EMPTY_CRITERIA,
        criteriaType: "HIGHEST_WIN_RATE",
      },
      dates,
    }),
  ];
}
