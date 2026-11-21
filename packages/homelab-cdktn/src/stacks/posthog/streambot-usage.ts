import { weeklyTrend } from "#src/stacks/posthog/feature-usage.ts";

/**
 * Streambot web remote usage, from the server-side events in
 * `packages/streambot/src/observability/product-analytics.ts` and the browser
 * events in `packages/streambot/src/web/client/telemetry/events.ts`. Every property
 * is a member of a closed set, a boolean or a bucket, and the distinct id is a
 * random UUID, so nothing here identifies a Discord user, guild, channel,
 * search text or title.
 */
export const STREAMBOT_USAGE_DASHBOARD = {
  id: "streambot_usage",
  name: "Streambot Usage",
  description:
    "How the Streambot web remote is used: weekly active users, plays by surface and placement, commands by action, search-to-play conversion, station starts, playlist actions, sign-ins, and from the browser: Listen vs Watch where both were offered, errors shown by code, and page views by route. Insights stay empty until the Streambot analytics producer is deployed.",
} as const;

const SEARCH_TO_PLAY_WINDOW_MINUTES = 30;

/** Share of searching users who request a play within the window (funnels count unique users). */
const searchToPlay = {
  kind: "InsightVizNode",
  source: {
    dateRange: {
      date_from: "-90d",
      explicitDate: false,
    },
    filterTestAccounts: false,
    funnelsFilter: {
      funnelOrderType: "ordered",
      funnelStepReference: "total",
      funnelVizType: "steps",
      funnelWindowInterval: SEARCH_TO_PLAY_WINDOW_MINUTES,
      funnelWindowIntervalUnit: "minute",
    },
    kind: "FunnelsQuery",
    properties: [],
    series: ["streambot_search_performed", "streambot_play_requested"].map(
      (event) => ({ event, kind: "EventsNode", name: event }),
    ),
  },
};

/** Insights on the Streambot usage dashboard, by Terraform resource name. */
export const STREAMBOT_USAGE_INSIGHTS = {
  streambot_weekly_active_users: {
    name: "Weekly active users",
    description:
      "Distinct pseudonymous users with any Streambot web event, per week.",
    query: weeklyTrend({
      events: [null],
      display: "ActionsLineGraph",
      math: "dau",
      where: { app: "streambot" },
    }),
  },
  streambot_plays_by_surface: {
    name: "Play requests by surface (weekly)",
    description:
      "Play requests by entry point: web, slash command, message, voice, or card.",
    query: weeklyTrend({
      events: ["streambot_play_requested"],
      display: "ActionsStackedBar",
      breakdown: "surface",
    }),
  },
  streambot_plays_by_placement: {
    name: "Play requests by placement (weekly)",
    description: "Whether a play request queued, played next, or played now.",
    query: weeklyTrend({
      events: ["streambot_play_requested"],
      display: "ActionsStackedBar",
      breakdown: "placement",
    }),
  },
  streambot_plays_by_selection_kind: {
    name: "Play requests by selection kind (weekly)",
    description: "The kind of item each play request selected.",
    query: weeklyTrend({
      events: ["streambot_play_requested"],
      display: "ActionsStackedBar",
      breakdown: "selection_kind",
    }),
  },
  streambot_commands_by_action: {
    name: "Remote commands by action (weekly)",
    description: "Which remote controls people use.",
    query: weeklyTrend({
      events: ["streambot_command_used"],
      display: "ActionsStackedBar",
      breakdown: "action",
    }),
  },
  streambot_search_to_play: {
    name: "Search to play conversion",
    description: `Share of searching users who request a play within ${SEARCH_TO_PLAY_WINDOW_MINUTES.toString()} minutes. Needs the Streambot analytics producer deployed; insights are empty until it emits events.`,
    query: searchToPlay,
  },
  streambot_station_starts_by_kind: {
    name: "Station starts by kind (weekly)",
    description: "Radio and TV station starts.",
    query: weeklyTrend({
      events: ["streambot_station_started"],
      display: "ActionsStackedBar",
      breakdown: "kind",
    }),
  },
  streambot_station_starts_by_scope: {
    name: "Station starts by scope (weekly)",
    description: "The scope each station start was seeded from.",
    query: weeklyTrend({
      events: ["streambot_station_started"],
      display: "ActionsStackedBar",
      breakdown: "scope",
    }),
  },
  streambot_playlist_actions: {
    name: "Playlist actions (weekly)",
    description: "Playlist changes by action.",
    query: weeklyTrend({
      events: ["streambot_playlist_action"],
      display: "ActionsStackedBar",
      breakdown: "action",
    }),
  },
  streambot_sign_ins: {
    name: "Sign-ins (weekly)",
    description: "Successful Discord sign-ins to the web remote.",
    query: weeklyTrend({
      events: ["streambot_web_signed_in"],
      display: "ActionsLineGraph",
    }),
  },
  streambot_listen_vs_watch: {
    name: "Listen vs Watch on rows offering both (weekly)",
    description:
      "Which control people pressed on result rows that showed both Listen and Watch, from the browser's `streambot_result_chosen`.",
    query: weeklyTrend({
      events: ["streambot_result_chosen"],
      display: "ActionsStackedBar",
      breakdown: "button",
      where: { offered: "both" },
    }),
  },
  streambot_errors_by_code: {
    name: "Errors shown by code (weekly)",
    description:
      "Failures the web remote showed beside a control, by the shared error code (unknown codes report as `other`).",
    query: weeklyTrend({
      events: ["streambot_error_shown"],
      display: "ActionsStackedBar",
      breakdown: "code",
    }),
  },
  streambot_page_views_by_route: {
    name: "Page views by route (weekly)",
    description:
      "Web remote page views by route pattern; the browser never reports a concrete path or query.",
    query: weeklyTrend({
      events: ["$pageview"],
      display: "ActionsStackedBar",
      breakdown: "route",
      where: { $host: "streambot.sjer.red" },
    }),
  },
} as const;
