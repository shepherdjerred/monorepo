import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

const datasource = { type: "prometheus", uid: "prometheus" };

export function createAlertDashboardGrafanaDashboard() {
  const builder = new dashboard.DashboardBuilder("Alerts — Ledger Health")
    .uid("alert-dashboard")
    .tags(["alerts", "alertmanager"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Open critical")
      .datasource(datasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr('alert_dashboard_open_alerts{severity="critical"}')
          .legendFormat("critical"),
      )
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 0, y: 0, w: 6, h: 4 }),
  );
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Outbox depth")
      .datasource(datasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("alert_dashboard_email_outbox_depth")
          .legendFormat("messages"),
      )
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 6, y: 0, w: 6, h: 4 }),
  );
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Reconciliation age")
      .datasource(datasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "time() - alert_dashboard_last_reconciliation_timestamp_seconds",
          )
          .legendFormat("age"),
      )
      .unit("s")
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 12, y: 0, w: 6, h: 4 }),
  );
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Service up")
      .datasource(datasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            'up{namespace="alert-dashboard",service="alert-dashboard-alert-dashboard-service"}',
          )
          .legendFormat("up"),
      )
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 18, y: 0, w: 6, h: 4 }),
  );
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Open alerts by severity")
      .datasource(datasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("alert_dashboard_open_alerts")
          .legendFormat("{{severity}}"),
      )
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 4, w: 24, h: 8 }),
  );
  return builder;
}

export function exportAlertDashboardJson(): string {
  return exportDashboardWithHelmEscaping(
    createAlertDashboardGrafanaDashboard().build(),
  );
}
