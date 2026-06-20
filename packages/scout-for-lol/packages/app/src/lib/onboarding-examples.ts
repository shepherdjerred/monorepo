import { getSeasonChoices } from "@scout-for-lol/data";
import {
  EMPTY_REPORT_STATE,
  type ReportFormState,
} from "#src/components/report-form-fields.tsx";
import {
  EMPTY_STATE,
  type FormState,
} from "#src/components/competition-form-fields.tsx";

/**
 * Concrete starter presets shown on the "Report or competition?" page (and
 * used to seed the build form). Each `build` returns a fully-valid form
 * state for the given channel; the user tweaks and creates.
 */
export type ReportExample = {
  id: string;
  label: string;
  build: (channelId: string) => ReportFormState;
};

export type CompetitionExample = {
  id: string;
  label: string;
  build: (channelId: string) => FormState;
};

export const REPORT_EXAMPLES: ReportExample[] = [
  {
    id: "pairings",
    label: "Best duo pairings",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Best duo pairings",
      channelId,
      queryText:
        "select pair, games, win_rate from player_pairs where games >= 5 group by pair order by win_rate desc",
      outputFormat: "LEADERBOARD",
    }),
  },
  {
    id: "surrender",
    label: "Highest surrender %",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Highest surrender %",
      channelId,
      queryText:
        "select player, games, surrender_rate from match_participants group by player order by surrender_rate desc",
      outputFormat: "LEADERBOARD",
    }),
  },
  {
    id: "games",
    label: "Most games played",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Most games played",
      channelId,
      queryText:
        "select player, games from match_participants group by player order by games desc",
      outputFormat: "LEADERBOARD",
    }),
  },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Latest currently-joinable season (getSeasonChoices filters out ended ones).
const CURRENT_SEASON_ID = getSeasonChoices()[0]?.value ?? "";

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const COMPETITION_EXAMPLES: CompetitionExample[] = [
  {
    id: "rank",
    label: "Highest rank this season",
    build: (channelId) => ({
      ...EMPTY_STATE,
      title: "Highest Solo Queue rank this season",
      description: "Who can climb the highest before the season ends?",
      channelId,
      criteria: {
        criteriaType: "HIGHEST_RANK",
        queue: "SOLO",
        championId: "",
        minGames: "10",
      },
      dates: {
        mode: "SEASON",
        startDate: "",
        endDate: "",
        seasonId: CURRENT_SEASON_ID,
      },
    }),
  },
  {
    id: "games-2026",
    label: "Most games in 2026",
    build: (channelId) => ({
      ...EMPTY_STATE,
      title: "Most games in 2026",
      description: "Rack up the most games this year.",
      channelId,
      criteria: {
        criteriaType: "MOST_GAMES_PLAYED",
        queue: "ALL",
        championId: "",
        minGames: "10",
      },
      dates: {
        mode: "FIXED_DATES",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        seasonId: "",
      },
    }),
  },
  {
    id: "yuumi",
    label: "Most wins on Yuumi",
    build: (channelId) => {
      const now = new Date();
      return {
        ...EMPTY_STATE,
        title: "Most wins on Yuumi",
        description: "Most Yuumi wins over the next month.",
        channelId,
        criteria: {
          criteriaType: "MOST_WINS_CHAMPION",
          queue: "__ANY__",
          championId: "350",
          minGames: "10",
        },
        dates: {
          mode: "FIXED_DATES",
          startDate: toIsoDate(now),
          endDate: toIsoDate(new Date(now.getTime() + THIRTY_DAYS_MS)),
          seasonId: "",
        },
      };
    },
  },
];
