import { getCurrentSeason, getSeasonChoices } from "@scout-for-lol/data";
import {
  EMPTY_REPORT_STATE,
  type ReportFormState,
} from "#src/components/reports/report-form-fields.tsx";
import {
  EMPTY_STATE,
  type FormState,
} from "#src/components/competitions/competition-form-fields.tsx";

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

// The three starter reports, in canonically formatted ScoutQL v2. Aggregates
// are explicit (`COUNT(*)`, `AVG(flag::INT)`), the label column comes from
// GROUP BY rather than being selected, and the 30-day bound is an ordinary
// WHERE conjunct — the same shape the editor, the presets and the AI author.
// `onboarding-examples.test.ts` compiles every one of them.
const TEAMMATE_GROUPS_QUERY = `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM player_groups
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY group(all)
HAVING games >= 5
ORDER BY win_rate DESC
LIMIT 10
RENDER leaderboard`;

const SURRENDER_QUERY = `SELECT COUNT(*) AS games, AVG(surrendered::INT) AS surrender_rate
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY surrender_rate DESC
LIMIT 10
RENDER leaderboard`;

const MOST_GAMES_QUERY = `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY
GROUP BY player
ORDER BY games DESC
LIMIT 10
RENDER leaderboard`;

export const REPORT_EXAMPLES: ReportExample[] = [
  {
    id: "pairings",
    label: "Best teammate groups",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Best teammate groups",
      channelId,
      queryText: TEAMMATE_GROUPS_QUERY,
    }),
  },
  {
    id: "surrender",
    label: "Highest surrender %",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Highest surrender %",
      channelId,
      queryText: SURRENDER_QUERY,
    }),
  },
  {
    id: "games",
    label: "Most games played",
    build: (channelId) => ({
      ...EMPTY_REPORT_STATE,
      title: "Most games played",
      channelId,
      queryText: MOST_GAMES_QUERY,
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
        queues: ["solo"],
        aggregation: "MAX",
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
          queues: ["ALL"],
          aggregation: "MAX",
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
          queues: ["ALL"],
          aggregation: "MAX",
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
