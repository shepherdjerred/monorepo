import type {
  ReportChartLegend,
  ReportChartOptions,
  VisualizationSnapshot,
} from "@scout-for-lol/data";
import { evidenceGames, isLowSampleGameCount } from "@scout-for-lol/data";
import type * as echarts from "echarts";
import {
  analyticsChartColors,
  analyticsChartTheme,
  type AnalyticsChartTheme,
} from "#src/html/analytics-chart-theme.ts";
import {
  formatPercent,
  isPercentageSeries,
} from "#src/html/visualization-value-format.ts";
import { scoutThemes } from "@scout-for-lol/design-system/themes";

const typography = scoutThemes["modern-light"].typography;
const displayTokens = typography.display
  .split(",")
  .map((token) => token.trim());
export const VISUALIZATION_DISPLAY_FONT = [
  "Beaufort for LoL",
  "Beaufort for LOL",
  ...displayTokens.filter(
    (token) => token !== "Beaufort for LoL" && token !== "Beaufort for LOL",
  ),
].join(", ");
export const VISUALIZATION_BODY_FONT = typography.body;
export const VISUALIZATION_MONO_FONT = typography.mono;

export type VisualizationRenderMode = "interactive" | "static";

function interactiveFont(mode: VisualizationRenderMode, family: string) {
  return mode === "interactive" ? { fontFamily: family } : {};
}

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
  mode: VisualizationRenderMode,
): echarts.EChartsOption {
  const { options, theme, colors } =
    visualizationSnapshotPresentation(snapshot);
  const thinRateData = snapshot.series.some(
    (series) =>
      isPercentageSeries(snapshot, series) &&
      series.points.some((point) => {
        const comparisonGames =
          point.comparisonEvidence === undefined ||
          point.comparisonEvidence === null
            ? undefined
            : evidenceGames(point.comparisonEvidence);
        return (
          isLowSampleGameCount(evidenceGames(point.evidence)) ||
          (comparisonGames !== undefined &&
            isLowSampleGameCount(comparisonGames))
        );
      }),
  );
  const subtitle = [
    options.subtitle,
    thinRateData
      ? "Fewer than 10 games — treat this rate as indicative only."
      : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(" · ");
  return {
    backgroundColor: theme.background,
    animation: false,
    color: colors,
    textStyle: {
      color: theme.text,
      ...interactiveFont(mode, VISUALIZATION_BODY_FONT),
    },
    title: {
      text: snapshot.title ?? defaultTitle,
      ...(subtitle.length === 0 ? {} : { subtext: subtitle }),
      left: 28,
      top: 18,
      textStyle: {
        color: theme.accent,
        fontSize: 28,
        ...interactiveFont(mode, VISUALIZATION_DISPLAY_FONT),
        ...(mode === "interactive" ? { fontWeight: 700 } : {}),
      },
      subtextStyle: {
        color: theme.muted,
        fontSize: 14,
        ...interactiveFont(mode, VISUALIZATION_BODY_FONT),
      },
    },
  };
}

export function visualizationSnapshotLegend(
  presentation: VisualizationSnapshotPresentation,
  fallback: ReportChartLegend = "top",
  mode: VisualizationRenderMode,
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
    textStyle: {
      color: presentation.theme.muted,
      ...interactiveFont(mode, VISUALIZATION_BODY_FONT),
    },
  };
}

export function visualizationSnapshotAxis(
  theme: AnalyticsChartTheme,
  name: string | undefined,
  mode: VisualizationRenderMode,
): object {
  return {
    ...(name === undefined
      ? {}
      : {
          name,
          nameTextStyle: {
            color: theme.muted,
            ...interactiveFont(mode, VISUALIZATION_BODY_FONT),
          },
        }),
    axisLabel: {
      color: theme.muted,
      ...interactiveFont(mode, VISUALIZATION_BODY_FONT),
    },
    axisLine: { lineStyle: { color: theme.border } },
    splitLine: { lineStyle: { color: theme.grid } },
  };
}

type VisualizationLabelOptions = {
  defaultShow?: boolean;
  valueFormatter?: (input: unknown) => string;
  mode?: VisualizationRenderMode;
};

export function visualizationSnapshotLabels(
  options: ReportChartOptions,
  horizontal: boolean,
  labelOptions: VisualizationLabelOptions = {},
): object {
  const { defaultShow = false, valueFormatter, mode = "static" } = labelOptions;
  return {
    show:
      options.labels === undefined || options.labels === "auto"
        ? defaultShow
        : options.labels === "show" ||
          options.labels === "value" ||
          options.labels === "percent",
    position: horizontal ? "right" : "top",
    ...interactiveFont(mode, VISUALIZATION_BODY_FONT),
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
