import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type PrometheusDatasource = { type: string; uid: string };

const FILTER = 'environment=~"$environment",instance=~"$server"';
const buildFilter = () => FILTER;

/**
 * Adds the "API Activity" and "Competition leaderboard chart" rows.
 * Extracted into its own file to keep `createScoutDashboard` under the
 * 400-line ESLint cap.
 */
export function addApiAndCompetitionRows(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: PrometheusDatasource,
): void {
  // Row 5: API Activity
  builder.withRow(new dashboard.RowBuilder("API Activity"));

  // Riot API Request Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Riot API Request Rate")
      .description("Requests per second to Riot API")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (rate(riot_api_requests_total{${buildFilter()}}[5m]))`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 41, w: 12, h: 8 }),
  );

  // Database Query Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Database Query Rate")
      .description("Database queries per second")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (rate(database_queries_total{${buildFilter()}}[5m]))`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 41, w: 12, h: 8 }),
  );

  // Reports Generated
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Reports Generated")
      .description("Match reports generated per minute")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (rate(reports_generated_total{${buildFilter()}}[5m])) * 60`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 49, w: 8, h: 8 }),
  );

  // Reports Failed
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Reports Failed")
      .description("Match report generation failures per minute")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (rate(reports_failed_total{${buildFilter()}}[5m])) * 60`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.01, color: "yellow" },
            { value: 1, color: "red" },
          ]),
      )
      .gridPos({ x: 8, y: 49, w: 8, h: 8 }),
  );

  // Riot API Errors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Riot API Errors")
      .description("All errors from Riot API by HTTP status")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, http_status) (rate(riot_api_errors_total{${buildFilter()}}[5m]))`,
          )
          .legendFormat("{{environment}} - {{http_status}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.01, color: "yellow" },
            { value: 0.1, color: "red" },
          ]),
      )
      .gridPos({ x: 16, y: 49, w: 8, h: 8 }),
  );

  // Participant Mismatches (known Riot API bug)
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Participant Mismatches")
      .description(
        "Riot API metadata/info participant inconsistencies per minute",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (rate(participant_mismatch_total{${buildFilter()}}[5m])) * 60`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.01, color: "yellow" },
            { value: 1, color: "red" },
          ]),
      )
      .gridPos({ x: 0, y: 57, w: 8, h: 8 }),
  );

  // Row 6: Competition leaderboard chart
  builder.withRow(new dashboard.RowBuilder("Competition leaderboard chart"));

  // Render duration p50 / p95 by criteria type
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Chart render duration p50 / p95")
      .description(
        "End-to-end time to build a competition leaderboard chart attachment (load snapshots, render SVG via ECharts, rasterize via resvg)",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.5, sum by (environment, criteria_type, le) (rate(leaderboard_chart_render_duration_seconds_bucket{${buildFilter()}}[5m])))`,
          )
          .legendFormat("p50 {{environment}} - {{criteria_type}}"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum by (environment, criteria_type, le) (rate(leaderboard_chart_render_duration_seconds_bucket{${buildFilter()}}[5m])))`,
          )
          .legendFormat("p95 {{environment}} - {{criteria_type}}"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(5)
      .gridPos({ x: 0, y: 65, w: 12, h: 8 }),
  );

  // Render outcome rate (success / error / skipped)
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Chart render outcomes")
      .description(
        "Rate of leaderboard chart render attempts by outcome status",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, status) (rate(leaderboard_chart_renders_total{${buildFilter()}}[5m])) * 60`,
          )
          .legendFormat("{{environment}} - {{status}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.01, color: "yellow" },
            { value: 0.1, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 65, w: 12, h: 8 }),
  );

  // PNG size distribution — catches blank-render regressions and pathological growth
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Chart PNG size p50 / p95")
      .description(
        "Bytes produced by resvg per chart. p95 dropping toward 0 implies blank renders; spikes above ~800 KB warrant investigation.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.5, sum by (environment, le) (rate(leaderboard_chart_png_bytes_bucket{${buildFilter()}}[15m])))`,
          )
          .legendFormat("p50 {{environment}}"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum by (environment, le) (rate(leaderboard_chart_png_bytes_bucket{${buildFilter()}}[15m])))`,
          )
          .legendFormat("p95 {{environment}}"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(5)
      .gridPos({ x: 0, y: 73, w: 12, h: 8 }),
  );

  // S3 snapshot fetch latency
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Snapshot fetch latency p95")
      .description(
        "S3 latency for historical leaderboard snapshot operations (list = ListObjectsV2 per competition; get = single GetObject)",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum by (environment, operation, le) (rate(leaderboard_snapshot_fetch_duration_seconds_bucket{${buildFilter()}}[5m])))`,
          )
          .legendFormat("{{environment}} - {{operation}}"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 73, w: 12, h: 8 }),
  );
}
