/**
 * Scout feature usage: the standing answer to "which features are actually
 * used, and how much". Collected events had no dashboard before this: every
 * report/competition/Explore/profile SPA event, `discord_command_used`, and
 * `voice_question_asked` flowed to PostHog without a single insight over them.
 */
export const FEATURE_USAGE_DASHBOARD = {
  id: "scout_feature_usage",
  name: "Scout Feature Usage",
  description:
    "Which Scout features are actually used: progression actions, creation/usage events, Discord commands by name and subcommand, and voice questions.",
} as const;

export type WeeklyTrend = {
  /** Events charted as one series each; `null` is every event. */
  readonly events: readonly (string | null)[];
  readonly display: "ActionsLineGraph" | "ActionsStackedBar";
  /** Event property the single series is broken down by. */
  readonly breakdown?: string;
  /** Aggregation of every series; PostHog's default is a raw event count. */
  readonly math?: "total" | "dau";
  /** Exact-match event property filters applied to every series. */
  readonly where?: Readonly<Record<string, string>>;
};

/** A 90-day weekly trends query; raw event counts unless `math` says otherwise. */
export function weeklyTrend({
  events,
  display,
  breakdown,
  math,
  where = {},
}: WeeklyTrend) {
  return {
    kind: "InsightVizNode",
    source: {
      ...(breakdown === undefined
        ? {}
        : { breakdownFilter: { breakdown, breakdown_type: "event" } }),
      dateRange: {
        date_from: "-90d",
        excludeIncompletePeriods: false,
        explicitDate: false,
      },
      filterTestAccounts: false,
      interval: "week",
      kind: "TrendsQuery",
      properties: Object.entries(where).map(([key, value]) => ({
        key,
        operator: "exact",
        type: "event",
        value: [value],
      })),
      series: events.map((event) => ({
        event,
        kind: "EventsNode",
        ...(math === undefined ? {} : { math }),
        name: event ?? "All events",
      })),
      trendsFilter: {
        aggregationAxisFormat: "numeric",
        display,
        showAlertThresholdLines: false,
        showLegend: true,
        showPercentStackView: false,
        showValuesOnSeries: false,
        smoothingIntervals: 1,
        yAxisScaleType: "linear",
      },
    },
  };
}

/** Insights on the feature-usage dashboard, by Terraform resource name. */
export const FEATURE_USAGE_INSIGHTS = {
  scout_progression_actions_weekly: {
    name: "Progression feature actions (weekly)",
    description:
      "Hall of Fame, challenge, and duel actions per week — the previously uninstrumented features.",
    query: weeklyTrend({
      events: [
        "hall_record_broken",
        "hall_settings_changed",
        "hall_baseline_requested",
        "challenge_run_started",
        "challenge_template_published",
        "duel_challenge_issued",
        "duel_event_created",
      ],
      display: "ActionsLineGraph",
    }),
  },
  scout_creation_usage_weekly: {
    name: "Creation and usage events (weekly)",
    description:
      "Creation and consumption events that were collected but never charted: reports, competitions, Explore turns, profile opens.",
    query: weeklyTrend({
      events: [
        "report_created",
        "report_run",
        "competition_created",
        "explore_turn_finished",
        "player_profile_opened",
      ],
      display: "ActionsLineGraph",
    }),
  },
  scout_discord_commands_by_name: {
    name: "Discord commands by name (weekly)",
    description: "Which slash commands members actually run.",
    query: weeklyTrend({
      events: ["discord_command_used"],
      display: "ActionsStackedBar",
      breakdown: "command_name",
    }),
  },
  scout_voice_questions_by_outcome: {
    name: "Voice questions by outcome (weekly)",
    description: "Hey Scout voice questions split by turn outcome.",
    query: weeklyTrend({
      events: ["voice_question_asked"],
      display: "ActionsStackedBar",
      breakdown: "outcome",
    }),
  },
} as const;
