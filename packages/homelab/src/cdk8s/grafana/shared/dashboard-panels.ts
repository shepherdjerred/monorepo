/**
 * Shared Grafana panel builders.
 */
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
  description?: string;
  targets: { query: string; legend: string }[];
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
  /**
   * Stack the series. `referenceLegends` names the series (by legend) that stay
   * out of the stack and draw as dashed lines instead: limits and totals to
   * compare the stack against.
   */
  stacked?: { referenceLegends: readonly string[] };
}) {
  const panel = new timeseries.PanelBuilder()
    .title(options.title)
    .datasource(PROMETHEUS_DS)
    .unit(options.unit ?? "short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(options.gridPos);

  if (options.description !== undefined) {
    panel.description(options.description);
  }

  if (options.stacked !== undefined) {
    panel
      .fillOpacity(40)
      .stacking(
        new common.StackingConfigBuilder().mode(common.StackingMode.Normal),
      );
    for (const legend of options.stacked.referenceLegends) {
      panel.overrideByName(legend, [
        { id: "custom.stacking", value: { mode: "none", group: "A" } },
        { id: "custom.fillOpacity", value: 0 },
        { id: "custom.lineStyle", value: { fill: "dash", dash: [10, 10] } },
      ]);
    }
  }

  for (const target of options.targets) {
    panel.withTarget(
      new prometheus.DataqueryBuilder()
        .expr(target.query)
        .legendFormat(target.legend),
    );
  }

  return panel;
}
