import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as table from "@grafana/grafana-foundation-sdk/table";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

import {
  SCOUT_DASHBOARD_FILTER,
  type PrometheusDatasource,
} from "./scout-dashboard-filter.ts";

const PREMATCH_FILTER = SCOUT_DASHBOARD_FILTER;

/**
 * Adds the entire "Pre-match" row to the dashboard: V2 discovery's probe
 * outcomes, loading-screen and spectator-payload save outcomes and latency,
 * skin fallbacks, spectator call volume, and the V2 spectator breaker.
 *
 * Lives in its own file purely to keep `createScoutDashboard` under the
 * 400-line ESLint cap.
 */
export function addPreMatchRow(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: PrometheusDatasource,
): void {
  builder.withRow(
    new dashboard.RowBuilder("Pre-match").gridPos({
      x: 0,
      y: 27,
      w: 24,
      h: 1,
    }),
  );

  // Prematch Detections
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Prematch Detections")
      .description(
        "Spectator probes per minute from V2 prematch discovery, by outcome: game, idle, unreadable",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, status) (rate(prematch_detections_total{${PREMATCH_FILTER}}[5m])) * 60`,
          )
          .legendFormat("{{environment}} - {{status}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 28, w: 14, h: 8 }),
  );

  // Loading Screen Outcomes
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Loading Screen Outcomes")
      .description("Prematch loading screen generation outcomes per minute")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, status) (rate(prematch_loading_screen_generated_total{${PREMATCH_FILTER}}[5m])) * 60`,
          )
          .legendFormat("{{environment}} - {{status}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 14, y: 28, w: 10, h: 8 }),
  );

  // Spectator Payload Save Outcomes
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Spectator Payload Save Outcomes")
      .description("Prematch spectator payload save outcomes per minute")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, status) (rate(prematch_spectator_payload_saves_total{${PREMATCH_FILTER}}[5m])) * 60`,
          )
          .legendFormat("{{environment}} - {{status}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 36, w: 12, h: 8 }),
  );

  // Spectator Payload Save p95
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Spectator Payload Save p95")
      .description("95th percentile prematch spectator payload save latency")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum by (environment, le) (rate(prematch_spectator_payload_save_duration_seconds_bucket{${PREMATCH_FILTER}}[5m])))`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 36, w: 12, h: 8 }),
  );

  // Loading Screen Generation p95
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Loading Screen Generation p95")
      .description("95th percentile loading-screen image generation latency")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum by (environment, le) (rate(prematch_loading_screen_duration_seconds_bucket{${PREMATCH_FILTER}}[5m])))`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 44, w: 24, h: 8 }),
  );

  // Skin Fallback Rate (informational — non-zero but stable is expected
  // briefly after Riot ships a new skin until the next update-data-dragon).
  // `or on() vector(0)` so the panel renders a flat 0 line instead of "No data"
  // when no fallbacks have happened in the lookback window.
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Loading Screen Skin Fallback Rate")
      .description(
        "Loading screens that fell back to base skin (skin 0) because the requested skin's JPG was missing on disk. Should be ~0 except briefly after Riot ships new skins.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (rate(prematch_loading_screen_skin_fallback_total{${PREMATCH_FILTER}}[5m])) * 60 or on() vector(0)`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 52, w: 12, h: 8 }),
  );

  // Top Fallback Skins (24h) — table showing which champion+skin combos
  // are missing assets, so we know what to chase up in update-data-dragon
  builder.withPanel(
    new table.PanelBuilder()
      .title("Top Fallback Skins (24h)")
      .description(
        "Champion+skin combinations that hit the runtime fallback most often in the last 24 hours. Indicates which skins update-data-dragon needs to refresh.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `topk(10, sum by (champion, requested_skin) (increase(prematch_loading_screen_skin_fallback_total{${PREMATCH_FILTER}}[24h]))) or on() vector(0)`,
          )
          .legendFormat("{{champion}} skin {{requested_skin}}")
          .format(prometheus.PromQueryFormat.Table)
          .instant(),
      )
      .gridPos({ x: 12, y: 52, w: 12, h: 8 }),
  );

  // Spectator API Call Rate (sanity-check Fix 1's effect on call volume —
  // should rise modestly after Fix 1 deploys and then plateau, not climb
  // unbounded)
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Spectator API Call Rate")
      .description(
        "Calls per second to the Riot Spectator API. Removing the per-PUUID skip-list (Fix 1) increases this modestly — watch for unbounded growth.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, status) (rate(riot_api_requests_total{source="spectator",${PREMATCH_FILTER}}[5m]))`,
          )
          .legendFormat("{{environment}} - {{status}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 60, w: 24, h: 8 }),
  );

  // Spectator Circuit Breaker State (0=closed, 1=open, 2=half-open)
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Spectator Circuit Breaker")
      .description(
        "V2 prematch discovery's spectator API circuit breaker (spectator-api-v2) per instance. 0 = closed (healthy), 1 = open (skipping requests), 2 = half-open (probing).",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `max by (environment) (circuit_breaker_state{name="spectator-api-v2",${PREMATCH_FILTER}})`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Background)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 1, color: "red" },
            { value: 2, color: "yellow" },
          ]),
      )
      .gridPos({ x: 0, y: 68, w: 24, h: 4 }),
  );
}
