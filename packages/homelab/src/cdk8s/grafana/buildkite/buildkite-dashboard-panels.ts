import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";

const PROMETHEUS_DS = {
  type: "prometheus",
  uid: "Prometheus",
};

export function createStatPanel(options: {
  title: string;
  description?: string;
  query: string;
  legend: string;
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
  instant?: boolean;
  thresholds?: { value: number; color: string }[];
}) {
  const target = new prometheus.DataqueryBuilder()
    .expr(options.query)
    .legendFormat(options.legend);

  if (options.instant === true) {
    target.instant();
  }

  const panel = new stat.PanelBuilder()
    .title(options.title)
    .datasource(PROMETHEUS_DS)
    .withTarget(target)
    .unit(options.unit ?? "short")
    .colorMode(common.BigValueColorMode.Value)
    .graphMode(common.BigValueGraphMode.Area)
    .gridPos(options.gridPos);

  if (options.description !== undefined) {
    panel.description(options.description);
  }

  if (options.thresholds) {
    panel.thresholds(
      new dashboard.ThresholdsConfigBuilder()
        .mode(dashboard.ThresholdsMode.Absolute)
        .steps(options.thresholds),
    );
  }

  return panel;
}

export function createTimeseriesPanel(options: {
  title: string;
  targets: { query: string; legend: string }[];
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
}) {
  const panel = new timeseries.PanelBuilder()
    .title(options.title)
    .datasource(PROMETHEUS_DS)
    .unit(options.unit ?? "short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(options.gridPos);

  for (const target of options.targets) {
    panel.withTarget(
      new prometheus.DataqueryBuilder()
        .expr(target.query)
        .legendFormat(target.legend),
    );
  }

  return panel;
}
