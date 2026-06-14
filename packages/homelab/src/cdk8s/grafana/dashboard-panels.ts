// Shared Grafana panel constructors used across dashboards.

const PROMETHEUS_DATASOURCE = {
  type: "prometheus",
  uid: "Prometheus",
};

export function target(expr: string, legendFormat: string, refId = "A") {
  return {
    datasource: PROMETHEUS_DATASOURCE,
    editorMode: "code",
    expr,
    legendFormat,
    range: true,
    refId,
  };
}

export function statPanel(input: {
  id: number;
  title: string;
  description: string;
  expr: string;
  legend: string;
  x: number;
  y: number;
  w: number;
  h: number;
  unit?: string;
}) {
  return {
    id: input.id,
    type: "stat",
    title: input.title,
    description: input.description,
    datasource: PROMETHEUS_DATASOURCE,
    gridPos: { x: input.x, y: input.y, w: input.w, h: input.h },
    fieldConfig: {
      defaults: {
        unit: input.unit ?? "short",
        color: { mode: "thresholds" },
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "red", value: null },
            { color: "green", value: 1 },
          ],
        },
      },
      overrides: [],
    },
    options: {
      colorMode: "value",
      graphMode: "area",
      justifyMode: "auto",
      orientation: "auto",
      reduceOptions: {
        calcs: ["lastNotNull"],
        fields: "",
        values: false,
      },
      textMode: "auto",
    },
    targets: [target(input.expr, input.legend)],
  };
}

export function timeseriesPanel(input: {
  id: number;
  title: string;
  description: string;
  targets: { expr: string; legend: string }[];
  x: number;
  y: number;
  w: number;
  h: number;
  unit?: string;
}) {
  return {
    id: input.id,
    type: "timeseries",
    title: input.title,
    description: input.description,
    datasource: PROMETHEUS_DATASOURCE,
    gridPos: { x: input.x, y: input.y, w: input.w, h: input.h },
    fieldConfig: {
      defaults: {
        unit: input.unit ?? "short",
        color: { mode: "palette-classic" },
        custom: {
          drawStyle: "line",
          lineInterpolation: "linear",
          barAlignment: 0,
          lineWidth: 1,
          fillOpacity: 10,
          gradientMode: "none",
          spanNulls: false,
          showPoints: "never",
          pointSize: 5,
          stacking: { mode: "none", group: "A" },
          axisPlacement: "auto",
          axisLabel: "",
          axisColorMode: "text",
          scaleDistribution: { type: "linear" },
          hideFrom: { tooltip: false, viz: false, legend: false },
          thresholdsStyle: { mode: "off" },
        },
      },
      overrides: [],
    },
    options: {
      tooltip: { mode: "multi", sort: "none" },
      legend: { displayMode: "list", placement: "bottom", calcs: [] },
    },
    targets: input.targets.map(({ expr, legend }, index) =>
      target(expr, legend, String.fromCodePoint(65 + index)),
    ),
  };
}
