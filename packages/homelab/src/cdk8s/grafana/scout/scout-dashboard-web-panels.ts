import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type PrometheusDatasource = { type: string; uid: string };

const FILTER = 'environment=~"$environment",instance=~"$server"';
const buildFilter = () => FILTER;

/**
 * "Web surface" rows: HTTP and tRPC health for the dashboard SPA's backend.
 *
 * These panels exist because the web UI previously had no server-side
 * instrumentation at all — the backend served `/metrics` but published nothing
 * about its own HTTP or tRPC traffic, so a user hitting 5xx or getting stuck in
 * onboarding was invisible in prod.
 */
export function addWebSurfaceRows(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: PrometheusDatasource,
): void {
  builder.withRow(
    new dashboard.RowBuilder("Web surface").gridPos({
      x: 0,
      y: 150,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("HTTP responses by status class")
      .description(
        "Requests/sec served by the backend, bucketed by status class. Routes are normalized patterns, never raw paths.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (status_class) (rate(scout_http_requests_total{${buildFilter()}}[5m]))`,
          )
          .legendFormat("{{status_class}}"),
      )
      .unit("reqps")
      .gridPos({ x: 0, y: 151, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Server errors (5xx) by route")
      .description("Backend faults. Any sustained value here is a real bug.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (route) (rate(scout_http_requests_total{${buildFilter()},status_class="5xx"}[5m]))`,
          )
          .legendFormat("{{route}}"),
      )
      .unit("reqps")
      .gridPos({ x: 12, y: 151, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("HTTP p95 latency by route")
      .description(
        "95th percentile request duration. `/metrics` is excluded at source: it sweeps the DB per scrape, so its cost is not user-facing latency.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum by (route, le) (rate(scout_http_request_duration_seconds_bucket{${buildFilter()}}[5m])))`,
          )
          .legendFormat("{{route}}"),
      )
      .unit("s")
      .gridPos({ x: 0, y: 159, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("tRPC errors by procedure")
      .description(
        "Non-OK tRPC results, excluding UNAUTHORIZED/FORBIDDEN — those are ordinary anonymous and permission traffic, not faults.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (procedure, code) (rate(scout_trpc_calls_total{${buildFilter()},code!~"OK|UNAUTHORIZED|FORBIDDEN"}[5m]))`,
          )
          .legendFormat("{{procedure}} {{code}}"),
      )
      .unit("reqps")
      .gridPos({ x: 12, y: 159, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Discord upstream failures")
      .description(
        "Failures fetching the signed-in user's guilds. Anything other than token_refresh_failed means Discord is unreachable — which used to surface to users as the flatly wrong 'You are not a member of that guild'.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (reason) (rate(scout_discord_user_guilds_failures_total{${buildFilter()}}[15m]))`,
          )
          .legendFormat("{{reason}}"),
      )
      .unit("reqps")
      .gridPos({ x: 0, y: 167, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Web sign-ins")
      .description(
        "Sign-in funnel by result. `started` is a redirect to Discord; the gap to `succeeded` is drop-off in the OAuth round-trip.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (result) (increase(scout_web_signin_total{${buildFilter()}}[1h]))`,
          )
          .legendFormat("{{result}}"),
      )
      .unit("short")
      .gridPos({ x: 12, y: 167, w: 12, h: 8 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Session rejections (24h)")
      .description(
        "Requests with no usable session. `absent` is normal anonymous traffic; a rise in `invalid` or `unknown_user` is the signal worth chasing.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (reason) (increase(scout_web_session_rejected_total{${buildFilter()}}[24h])) or on() vector(0)`,
          )
          .legendFormat("{{reason}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 0, y: 175, w: 12, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Guilds left (30d)")
      .description(
        "Confirmed removals. Churn was previously uninstrumented — the old guilds_left_total series had no producer, so removals could only be counted by hand.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (increase(scout_guilds_left_total{${buildFilter()}}[30d])) or on() vector(0)`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 12, y: 175, w: 12, h: 4 }),
  );
}

/**
 * "Adoption funnel" row: install → sign-in → onboarding → first subscription.
 *
 * The question this answers is the one prod could not previously answer at all:
 * where do new servers stop converting?
 */
export function addAdoptionFunnelRows(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: PrometheusDatasource,
): void {
  builder.withRow(
    new dashboard.RowBuilder("Adoption funnel").gridPos({
      x: 0,
      y: 180,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Onboarding steps reached (24h)")
      .description(
        "Wizard steps reached, in flow order: install → pick-guild → concepts → subscribe-self → subscribe-more → done. The cliff between two adjacent steps is the friction point.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (step) (increase(scout_onboarding_step_total{${buildFilter()}}[24h]))`,
          )
          .legendFormat("{{step}}"),
      )
      .unit("short")
      .gridPos({ x: 0, y: 181, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Onboarding outcomes (24h)")
      .description(
        "How onboarding ended. Without this, finishing setup and hitting 'Skip setup' are indistinguishable — both simply stop emitting step events.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (outcome) (increase(scout_onboarding_outcome_total{${buildFilter()}}[24h]))`,
          )
          .legendFormat("{{outcome}}"),
      )
      .unit("short")
      .gridPos({ x: 12, y: 181, w: 12, h: 8 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Activation rate")
      .description(
        "Share of guilds with at least one tracked player. This sat near 47% and falling while installs grew — the headline adoption number.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `100 * sum by (environment) (servers_with_data_total{${buildFilter()}}) / sum by (environment) (discord_guilds{${buildFilter()}})`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("percent")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 0, y: 189, w: 8, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Guilds — nothing configured")
      .description(
        "Servers that have the bot but no subscriptions and no active competitions, so nothing will ever post.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (guild_unconfigured_total{${buildFilter()}}) or on() vector(0)`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 8, y: 189, w: 8, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Subscriptions")
      .description("Total tracked subscriptions across all servers.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (subscriptions_total{${buildFilter()}}) or on() vector(0)`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 16, y: 189, w: 8, h: 4 }),
  );
}
