import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type PrometheusDatasource = { type: string; uid: string };

const FILTER = 'environment=~"$environment",instance=~"$server"';
const buildFilter = () => FILTER;

/**
 * Adds scheduled report engine panels. Kept separate from the API and
 * competition rows so the dashboard helpers stay below the lint line cap.
 */
export function addScheduledReportRows(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: PrometheusDatasource,
): void {
  builder.withRow(
    new dashboard.RowBuilder("Scheduled report engine").gridPos({
      x: 0,
      y: 114,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Active scheduled reports")
      .description("Enabled scheduled reports known to the dispatcher")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (scheduled_reports_active{${buildFilter()}})`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 0, y: 115, w: 8, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Reports due")
      .description("Scheduled reports selected as due in the last hour")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (increase(scheduled_reports_due_total{${buildFilter()}}[1h]))`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 8, y: 115, w: 8, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Report failures")
      .description("Failed scheduled reports in the last hour")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (increase(scheduled_reports_failed_total{${buildFilter()}}[1h]))`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 1, color: "red" },
          ]),
      )
      .gridPos({ x: 16, y: 115, w: 8, h: 4 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Scheduled report runs")
      .description("Scheduled/manual report execution outcomes")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, status, trigger, system_source) (rate(scheduled_reports_run_total{${buildFilter()}}[5m])) * 60`,
          )
          .legendFormat(
            "{{environment}} - {{status}} - {{trigger}} - {{system_source}}",
          ),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 119, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Scheduled report duration p95")
      .description("95th percentile scheduled report runtime")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(0.95, sum by (environment, system_source, le) (rate(scheduled_reports_duration_ms_bucket{${buildFilter()}}[15m])))`,
          )
          .legendFormat("{{environment}} - {{system_source}}"),
      )
      .unit("ms")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 119, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Scheduled report rows scanned")
      .description("SQLite fact rows scanned by scheduled/manual reports")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, trigger, system_source) (rate(scheduled_reports_rows_scanned_total{${buildFilter()}}[5m])) * 60`,
          )
          .legendFormat("{{environment}} - {{trigger}} - {{system_source}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 127, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Scheduled report rows returned")
      .description("Rows emitted by scheduled/manual reports")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, trigger, system_source) (rate(scheduled_reports_rows_returned_total{${buildFilter()}}[5m])) * 60`,
          )
          .legendFormat("{{environment}} - {{trigger}} - {{system_source}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 127, w: 12, h: 8 }),
  );
}
