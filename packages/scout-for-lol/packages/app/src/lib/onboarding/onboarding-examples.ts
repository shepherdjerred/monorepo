import { getAllSeasons } from "@scout-for-lol/data";
import {
  EMPTY_REPORT_STATE,
  type ReportFormState,
} from "#src/components/report/report-form-fields.tsx";
import {
  buildCompetitionScenarios,
  type CompetitionScenarioContext,
} from "#src/lib/bucks/competition-scenarios.ts";
import { browserTimezone } from "#src/lib/bucks/competition-time.ts";

/**
 * Concrete starter presets shown on the "Report or competition?" page. A
 * report example's `build` returns a fully-valid form state for the given
 * channel; a competition example names a competition builder scenario, which
 * seeds the builder.
 */
export type ReportExample = {
  id: string;
  label: string;
  build: (channelId: string) => ReportFormState;
};

export type CompetitionExample = {
  id: string;
  label: string;
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

/** The builder scenarios the onboarding choice page offers, in order. */
const ONBOARDING_COMPETITION_SCENARIO_IDS = [
  "rank",
  "games-sprint",
  "yuumi",
] as const;

/**
 * Competition starters for the choice page, labelled with the title of the
 * builder scenario each one opens, so the choice and the seeded builder can
 * never describe different competitions. A season-based scenario with no
 * current or upcoming season is omitted.
 */
export function buildCompetitionExamples(
  context: CompetitionScenarioContext,
): CompetitionExample[] {
  const scenarios = buildCompetitionScenarios(context);
  return ONBOARDING_COMPETITION_SCENARIO_IDS.flatMap((id) => {
    const scenario = scenarios.find((candidate) => candidate.id === id);
    if (scenario === undefined) {
      throw new Error(`Onboarding names unknown competition scenario ${id}`);
    }
    return scenario.value === null ? [] : [{ id, label: scenario.value.title }];
  });
}

export const COMPETITION_EXAMPLES: CompetitionExample[] =
  buildCompetitionExamples({
    now: new Date(),
    timezone: browserTimezone(),
    seasons: getAllSeasons(),
  });
