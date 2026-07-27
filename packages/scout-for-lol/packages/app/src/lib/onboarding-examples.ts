import { getCurrentSeason, getSeasonChoices } from "@scout-for-lol/data";
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
  description: string;
  build: (channelId: string) => FormState;
};

export const REPORT_EXAMPLES: ReportExample[] = [
  {
    id: "pairings",
    label: "Best teammate groups",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Best teammate groups",
      channelId,
      queryText:
        "select group, games, win_rate from player_groups where game_creation_at >= current_timestamp - interval '30 days' and games >= 5 group by group(all) order by win_rate desc limit 10 render leaderboard",
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
        "select player, games, surrender_rate from match_participants where game_creation_at >= current_timestamp - interval '30 days' group by player order by surrender_rate desc limit 10 render leaderboard",
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
        "select player, games from match_participants where game_creation_at >= current_timestamp - interval '30 days' group by player order by games desc limit 10 render leaderboard",
    }),
  },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Fixed-date competitions are capped at 90 calendar days
// (MAX_COMPETITION_DURATION_DAYS), so a "year-long" fixed preset can't validate;
// a 60-day sprint stays comfortably inside the limit.
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
// The season active right now; falls back to the nearest joinable one between
// seasons (getSeasonChoices filters out ended seasons but includes future
// ones and is newest-start-first, so `.at(-1)` is the nearest upcoming one, not
// the furthest-future `[0]`). `undefined` when the catalog has no current-or-
// future season — the season-based "rank" preset is then omitted rather than
// seeding an empty seasonId that submits into a "Pick a season." error.
const CURRENT_SEASON_ID: string | undefined =
  getCurrentSeason()?.id ?? getSeasonChoices().at(-1)?.value;

function buildRankPreset(seasonId: string): CompetitionExample {
  return {
    id: "rank",
    label: "Highest rank this season",
    description:
      "Rank everyone by their peak Solo Queue rank before the season ends.",
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
        seasonId,
      },
    }),
  };
}

function toIsoDate(date: Date): string {
  // Use the browser-local calendar day, not the UTC slice of the ISO string:
  // `toISOString().slice(0,10)` shifts to the previous/next day for viewers far
  // from UTC, so a rolling "starts today" preset would seed the wrong date.
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const COMPETITION_EXAMPLES: CompetitionExample[] = [
  ...(CURRENT_SEASON_ID === undefined
    ? []
    : [buildRankPreset(CURRENT_SEASON_ID)]),
  {
    id: "games-sprint",
    label: "Most games — 2-month sprint",
    description:
      "A two-month race to see who grinds the most games across every queue.",
    build: (channelId) => {
      const now = new Date();
      return {
        ...EMPTY_STATE,
        title: "Most games — 2-month sprint",
        description: "Rack up the most games over the next two months.",
        channelId,
        criteria: {
          criteriaType: "MOST_GAMES_PLAYED",
          queue: "ALL",
          championId: "",
          minGames: "10",
        },
        dates: {
          mode: "FIXED_DATES",
          startDate: toIsoDate(now),
          endDate: toIsoDate(new Date(now.getTime() + SIXTY_DAYS_MS)),
          seasonId: "",
        },
      };
    },
  },
  {
    id: "yuumi",
    label: "Most wins on Yuumi",
    description:
      "A one-month sprint for the most wins on a single champion (Yuumi).",
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
