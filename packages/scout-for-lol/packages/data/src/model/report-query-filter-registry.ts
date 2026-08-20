/**
 * What a query may put in `WHERE`, and how it states its time period.
 *
 * Split from report-query-registry.ts to keep both files inside the
 * max-lines cap. The time-period section is the one part of the language
 * payload that has to reach an author who does not already know the clause
 * exists — for months it did not, and every AI-written query silently
 * covered 30 days as a result.
 */

export type ReportFilterInfo = {
  id: string;
  syntax: string;
  description: string;
};

const FILTER_DATA: [string, string, string][] = [
  ["player", 'player = "<name>"', "Restrict to a player alias."],
  ["queue", "queue IN (solo, flex, …)", "Restrict to queue types."],
  ["champion_id", "champion_id = <number>", "Restrict to a champion id."],
  [
    "team_position",
    "team_position = <position>",
    "Restrict to a team position.",
  ],
  [
    "individual_position",
    "individual_position = <position>",
    "Restrict to an individual position.",
  ],
  ["lane", "lane = <lane>", "Restrict to a lane."],
  ["role", "role = <role>", "Restrict to a role."],
  ["game_mode", "game_mode = <mode>", "Restrict to a game mode."],
  ["game_type", "game_type = <type>", "Restrict to a game type."],
  [
    "game_version",
    'game_version = "<version>"',
    "Restrict to an exact version.",
  ],
  ["map_id", "map_id = <number>", "Restrict to a map id."],
  ["win", "win = true|false", "Restrict by match outcome."],
  ["surrendered", "surrendered = true|false", "Restrict by surrender state."],
  [
    "early_surrendered",
    "early_surrendered = true|false",
    "Restrict by early surrender.",
  ],
  [
    "first_blood_kill",
    "first_blood_kill = true|false",
    "Restrict by first-blood credit.",
  ],
  [
    "game_duration_seconds",
    "game_duration_seconds <operator> <number>",
    "Filter by match length.",
  ],
  ["placement", "placement <operator> <number>", "Filter by Arena placement."],
  ["kills", "kills <operator> <number>", "Filter raw participant kills."],
  ["deaths", "deaths <operator> <number>", "Filter raw participant deaths."],
  ["assists", "assists <operator> <number>", "Filter raw participant assists."],
  [
    "creep_score",
    "creep_score <operator> <number>",
    "Filter raw participant creep score.",
  ],
  ["gold_earned", "gold_earned <operator> <number>", "Filter raw gold earned."],
  ["gold_spent", "gold_spent <operator> <number>", "Filter raw gold spent."],
  [
    "damage_to_champions",
    "damage_to_champions <operator> <number>",
    "Filter raw champion damage.",
  ],
  [
    "vision_score",
    "vision_score <operator> <number>",
    "Filter raw vision score.",
  ],
  ["games", "games >= <number>", "Require at least N aggregate games."],
  [
    "competition_id",
    "competition_id = <number>",
    "Scope competition-backed sources.",
  ],
];
export const REPORT_FILTERS: ReportFilterInfo[] = FILTER_DATA.map(
  ([id, syntax, description]) => ({ id, syntax, description }),
);

/**
 * The time period a query covers. Its own section rather than an entry in
 * FILTER_DATA because `DURING` is a top-level clause, not a WHERE predicate —
 * and because this list is the one thing that has to reach an author who does
 * not already know the window exists.
 *
 * It did not, for months. Neither AI agent could learn the syntax from the
 * language payload, so neither ever wrote one, and every answer silently
 * covered 30 days.
 */
const TIME_PERIOD_DATA: [string, string, string][] = [
  [
    "during_relative",
    "DURING LAST <n> DAYS",
    "Cover the last N days, counted back from now.",
  ],
  [
    "during_calendar",
    "DURING BETWEEN '<date>' AND '<date>' [IN TIME ZONE '<zone>']",
    "Cover two inclusive calendar dates. Days are UTC unless a timezone is given.",
  ],
  [
    "during_all_time",
    "DURING ALL TIME",
    "Cover every match in the lake. Use this for lifetime totals.",
  ],
  [
    "lookback_predicate",
    "<timestamp> >= CURRENT_TIMESTAMP - INTERVAL '<n> days'",
    "Compatibility form of DURING LAST <n> DAYS, written in WHERE. Use game_creation_at, or observed_at for prematch_participants. Prefer DURING.",
  ],
];
export const REPORT_TIME_PERIODS: ReportFilterInfo[] = TIME_PERIOD_DATA.map(
  ([id, syntax, description]) => ({ id, syntax, description }),
);
