import type {
  ReportChartLegend,
  ReportChartOptions,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import type * as echarts from "echarts";
import {
  analyticsChartColors,
  analyticsChartTheme,
  type AnalyticsChartTheme,
} from "#src/html/analytics-chart-theme.ts";
import { formatPercent } from "#src/html/visualization-value-format.ts";

export type VisualizationSnapshotPresentation = {
  options: ReportChartOptions;
  theme: AnalyticsChartTheme;
  colors: string[];
};

export function visualizationSnapshotPresentation(
  snapshot: VisualizationSnapshot,
): VisualizationSnapshotPresentation {
  const options = snapshot.display.options ?? {};
  const style = {
    ...(options.theme === undefined
      ? snapshot.display.theme === null
        ? {}
        : { theme: snapshot.display.theme }
      : { theme: options.theme }),
    ...(options.palette === undefined
      ? snapshot.display.palette === null
        ? {}
        : { palette: snapshot.display.palette }
      : { palette: options.palette }),
    ...(options.colors === undefined ? {} : { colors: options.colors }),
  };
  const theme = analyticsChartTheme(style);
  return { options, theme, colors: analyticsChartColors(style, theme) };
}

export function visualizationSnapshotBaseOption(
  snapshot: VisualizationSnapshot,
  defaultTitle: string,
): echarts.EChartsOption {
  const { options, theme, colors } =
    visualizationSnapshotPresentation(snapshot);
  return {
    backgroundColor: theme.background,
    animation: false,
    color: colors,
    textStyle: { color: theme.text },
    title: {
      text: snapshot.title ?? defaultTitle,
      ...(options.subtitle === undefined ? {} : { subtext: options.subtitle }),
      left: 28,
      top: 18,
      textStyle: { color: theme.accent, fontSize: 28 },
      subtextStyle: { color: theme.muted, fontSize: 14 },
    },
  };
}

export function visualizationSnapshotLegend(
  presentation: VisualizationSnapshotPresentation,
  fallback: ReportChartLegend = "top",
): echarts.LegendComponentOption {
  const position =
    presentation.options.legend === undefined ||
    presentation.options.legend === "auto"
      ? fallback
      : presentation.options.legend;
  const right = position === "right";
  const bottom = position === "bottom";
  return {
    show: position !== "none",
    type: "scroll",
    orient: right ? "vertical" : "horizontal",
    ...(right
      ? { right: 24, top: 72, bottom: 36 }
      : bottom
        ? { left: 68, right: 68, bottom: 18 }
        : { left: 68, right: 68, top: 62 }),
    textStyle: { color: presentation.theme.muted },
  };
}

export function visualizationSnapshotAxis(
  theme: AnalyticsChartTheme,
  name: string | undefined,
): object {
  return {
    ...(name === undefined
      ? {}
      : { name, nameTextStyle: { color: theme.muted } }),
    axisLabel: { color: theme.muted },
    axisLine: { lineStyle: { color: theme.border } },
    splitLine: { lineStyle: { color: theme.grid } },
  };
}

export function visualizationSnapshotLabels(
  options: ReportChartOptions,
  horizontal: boolean,
  defaultShow = false,
  valueFormatter?: (input: unknown) => string,
): object {
  return {
    show:
      options.labels === undefined || options.labels === "auto"
        ? defaultShow
        : options.labels === "show" ||
          options.labels === "value" ||
          options.labels === "percent",
    position: horizontal ? "right" : "top",
    ...(options.labels === "percent"
      ? { formatter: percentLabel }
      : valueFormatter !== undefined && options.labels === "value"
        ? { formatter: valueFormatter }
        : {}),
  };
}

function percentLabel(input: unknown): string {
  if (typeof input !== "object" || input === null || !("value" in input)) {
    return "";
  }
  return typeof input.value === "number" ? formatPercent(input.value) : "";
}
