import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";

export const PROMETHEUS_DATASOURCE = {
  type: "prometheus",
  uid: "Prometheus",
};

export function createStatPanel(options: {
  title: string;
  description: string;
  query: string;
  legend: string;
  gridPos: { x: number; y: number; w: number; h: number };
  thresholds: { value: number; color: string }[];
}) {
  return new stat.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(PROMETHEUS_DATASOURCE)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(options.query)
        .legendFormat(options.legend),
    )
    .unit("short")
    .colorMode(common.BigValueColorMode.Value)
    .graphMode(common.BigValueGraphMode.Area)
    .thresholds(
      new dashboard.ThresholdsConfigBuilder()
        .mode(dashboard.ThresholdsMode.Absolute)
        .steps(options.thresholds),
    )
    .gridPos(options.gridPos);
}

export function createTimeseriesPanel(options: {
  title: string;
  description: string;
  targets: { query: string; legend: string }[];
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string | undefined;
}) {
  const basePanel = new timeseries.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(PROMETHEUS_DATASOURCE)
    .unit(options.unit ?? "short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(options.gridPos);

  return options.targets.reduce(
    (panel, target) =>
      panel.withTarget(
        new prometheus.DataqueryBuilder()
          .expr(target.query)
          .legendFormat(target.legend),
      ),
    basePanel,
  );
}
