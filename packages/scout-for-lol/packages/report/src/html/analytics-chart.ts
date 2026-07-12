import type {
  ReportChartLabels,
  ReportChartLegend,
  ReportChartOrientation,
} from "@scout-for-lol/data";
import type * as echarts from "echarts";
import {
  ANALYTICS_BODY_FONT as BODY_FONT,
  ANALYTICS_CHART_HEIGHT as HEIGHT,
  ANALYTICS_CHART_WIDTH as WIDTH,
  ANALYTICS_FONT_FILE_PATHS as FONT_FILE_PATHS,
  ANALYTICS_TITLE_FONT as TITLE_FONT,
  analyticsChartColors as chartColors,
  analyticsChartTheme as chartTheme,
  type AnalyticsChartStyle,
  type AnalyticsChartTheme as Theme,
} from "#src/html/analytics-chart-theme.ts";
import {
  echartsOptionToSvg,
  echartsSvgToImage,
} from "#src/html/echarts-image.ts";

type AnalyticsChartCommon = AnalyticsChartStyle & {
  title: string;
  subtitle?: string;
  legend?: ReportChartLegend;
  labels?: ReportChartLabels;
};

export type AnalyticsChartSeries = {
  name: string;
  values: (number | null)[];
};

export type AnalyticsChartProps = AnalyticsChartCommon &
  (
    | {
        chartType: "bar" | "stacked_bar" | "line" | "area";
        categories: string[];
        series: AnalyticsChartSeries[];
        xAxisLabel?: string;
        yAxisLabel?: string;
        orientation?: ReportChartOrientation;
        smooth?: boolean;
        valueSuffix?: string;
      }
    | {
        chartType: "donut";
        items: { name: string; value: number }[];
        valueSuffix?: string;
      }
    | {
        chartType: "scatter";
        points: { name: string; x: number; y: number; size?: number }[];
        xAxisLabel: string;
        yAxisLabel: string;
      }
    | {
        chartType: "heatmap";
        xCategories: string[];
        yCategories: string[];
        cells: { x: number; y: number; value: number }[];
        valueSuffix?: string;
      }
    | {
        chartType: "radar";
        indicators: string[];
        series: { name: string; values: number[] }[];
      }
    | {
        chartType: "kpi";
        items: { label: string; value: string }[];
      }
  );

function showLabels(labels: ReportChartLabels | undefined): boolean {
  return labels === "show" || labels === "value" || labels === "percent";
}

function legend(theme: Theme, position: ReportChartLegend | undefined): object {
  const hidden = position === "none";
  const vertical = position === "right";
  return {
    show: !hidden,
    type: "scroll",
    orient: vertical ? "vertical" : "horizontal",
    ...(vertical
      ? { right: 30, top: 145, bottom: 55 }
      : { left: 80, right: 80, bottom: 24 }),
    textStyle: { color: theme.text, fontFamily: BODY_FONT, fontSize: 20 },
  };
}

function title(theme: Theme, props: AnalyticsChartProps): object {
  return {
    text: props.title,
    ...(props.subtitle === undefined ? {} : { subtext: props.subtitle }),
    left: 54,
    top: 28,
    textStyle: {
      color: theme.accent,
      fontFamily: TITLE_FONT,
      fontSize: 44,
      fontWeight: 700,
    },
    subtextStyle: { color: theme.muted, fontFamily: BODY_FONT, fontSize: 21 },
  };
}

function baseOption(props: AnalyticsChartProps): echarts.EChartsOption {
  const theme = chartTheme(props);
  return {
    animation: false,
    backgroundColor: theme.background,
    color: chartColors(props, theme),
    textStyle: { color: theme.text, fontFamily: BODY_FONT },
    title: title(theme, props),
  };
}

function axis(theme: Theme, name?: string): object {
  return {
    ...(name === undefined
      ? {}
      : { name, nameTextStyle: { color: theme.muted, fontSize: 20 } }),
    axisLine: { lineStyle: { color: theme.border } },
    axisTick: { lineStyle: { color: theme.border } },
    axisLabel: {
      color: theme.text,
      fontFamily: BODY_FONT,
      fontSize: 18,
      hideOverlap: true,
    },
    splitLine: { lineStyle: { color: theme.grid, type: "dashed" } },
  };
}

function cartesianOption(
  props: Extract<
    AnalyticsChartProps,
    { chartType: "bar" | "stacked_bar" | "line" | "area" }
  >,
): echarts.EChartsOption {
  const theme = chartTheme(props);
  const horizontal =
    props.orientation === "horizontal" &&
    props.chartType !== "line" &&
    props.chartType !== "area";
  const categoryAxis = {
    type: "category" as const,
    data: props.categories,
    ...axis(theme, props.xAxisLabel),
  };
  const valueAxis = {
    type: "value" as const,
    ...axis(theme, props.yAxisLabel),
    axisLabel: {
      color: theme.text,
      fontFamily: BODY_FONT,
      fontSize: 18,
      ...(props.valueSuffix === undefined
        ? {}
        : { formatter: `{value}${props.valueSuffix}` }),
    },
  };
  const isLine = props.chartType === "line" || props.chartType === "area";
  return {
    ...baseOption(props),
    legend: legend(theme, props.legend),
    grid: {
      left: 70,
      right: props.legend === "right" ? 300 : 70,
      top: 145,
      bottom: 90,
      containLabel: true,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: props.series.map((entry) => ({
      name: entry.name,
      type: isLine ? "line" : "bar",
      data: entry.values,
      ...(props.chartType === "stacked_bar" ? { stack: "total" } : {}),
      ...(props.chartType === "area"
        ? { stack: "total", areaStyle: { opacity: 0.38 } }
        : {}),
      ...(isLine
        ? {
            smooth: props.smooth ?? false,
            showSymbol: props.categories.length <= 16,
            connectNulls: true,
          }
        : {}),
      label: {
        show: showLabels(props.labels),
        position: horizontal ? "right" : "top",
        color: theme.text,
        fontSize: 17,
        ...(props.valueSuffix === undefined
          ? {}
          : { formatter: `{c}${props.valueSuffix}` }),
      },
    })),
  };
}

function donutOption(
  props: Extract<AnalyticsChartProps, { chartType: "donut" }>,
): echarts.EChartsOption {
  const theme = chartTheme(props);
  const percent = props.labels === "percent";
  return {
    ...baseOption(props),
    legend: legend(theme, props.legend),
    series: [
      {
        type: "pie",
        radius: ["36%", "68%"],
        center: ["50%", "53%"],
        data: props.items.map((item) => ({
          name: item.name,
          value: item.value,
        })),
        label: {
          show: props.labels !== "hide",
          color: theme.text,
          fontFamily: BODY_FONT,
          fontSize: 20,
          formatter: percent
            ? "{b}\n{d}%"
            : `{b}\n{c}${props.valueSuffix ?? ""}`,
        },
        labelLine: { lineStyle: { color: theme.border } },
        itemStyle: {
          borderColor: theme.panel,
          borderWidth: 3,
          borderRadius: 6,
        },
      },
    ],
  };
}

function scatterOption(
  props: Extract<AnalyticsChartProps, { chartType: "scatter" }>,
): echarts.EChartsOption {
  const theme = chartTheme(props);
  const sizes = props.points.map((point) => point.size ?? 1);
  const maxSize = Math.max(...sizes, 1);
  return {
    ...baseOption(props),
    grid: { left: 90, right: 75, top: 150, bottom: 85, containLabel: true },
    xAxis: { type: "value", ...axis(theme, props.xAxisLabel) },
    yAxis: { type: "value", ...axis(theme, props.yAxisLabel) },
    series: [
      {
        type: "scatter",
        data: props.points.map((point) => ({
          name: point.name,
          value: [point.x, point.y, point.size ?? 1],
        })),
        symbolSize: (value: unknown) => {
          const parsed =
            Array.isArray(value) && typeof value[2] === "number" ? value[2] : 1;
          return 18 + 54 * Math.sqrt(parsed / maxSize);
        },
        label: {
          show: props.labels !== "hide",
          formatter: "{b}",
          position: "top",
          color: theme.text,
          fontSize: 17,
        },
      },
    ],
  };
}

function heatmapOption(
  props: Extract<AnalyticsChartProps, { chartType: "heatmap" }>,
): echarts.EChartsOption {
  const theme = chartTheme(props);
  const values = props.cells.map((cell) => cell.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const colors = chartColors(props, theme);
  return {
    ...baseOption(props),
    grid: { left: 80, right: 110, top: 145, bottom: 110, containLabel: true },
    xAxis: { type: "category", data: props.xCategories, ...axis(theme) },
    yAxis: { type: "category", data: props.yCategories, ...axis(theme) },
    visualMap: {
      min,
      max,
      calculable: true,
      orient: "vertical",
      right: 25,
      top: "middle",
      textStyle: { color: theme.text },
      inRange: { color: colors },
    },
    series: [
      {
        type: "heatmap",
        data: props.cells.map((cell) => [cell.x, cell.y, cell.value]),
        label: {
          show: showLabels(props.labels),
          color: "#ffffff",
          textBorderColor: "#000000",
          textBorderWidth: 2,
          formatter: `{@[2]}${props.valueSuffix ?? ""}`,
        },
        itemStyle: { borderColor: theme.panel, borderWidth: 2 },
      },
    ],
  };
}

function radarOption(
  props: Extract<AnalyticsChartProps, { chartType: "radar" }>,
): echarts.EChartsOption {
  const theme = chartTheme(props);
  const maxima = props.indicators.map((_, index) =>
    Math.max(...props.series.map((entry) => entry.values[index] ?? 0), 1),
  );
  return {
    ...baseOption(props),
    legend: legend(theme, props.legend),
    radar: {
      center: ["50%", "52%"],
      radius: "67%",
      indicator: props.indicators.map((name, index) => ({
        name,
        max: maxima[index] ?? 1,
      })),
      axisName: { color: theme.text, fontSize: 18 },
      splitLine: { lineStyle: { color: theme.grid } },
      splitArea: { areaStyle: { color: [theme.panel, "transparent"] } },
      axisLine: { lineStyle: { color: theme.border } },
    },
    series: [
      {
        type: "radar",
        data: props.series.map((entry) => ({
          name: entry.name,
          value: entry.values,
          areaStyle: { opacity: 0.12 },
        })),
      },
    ],
  };
}

function kpiOption(
  props: Extract<AnalyticsChartProps, { chartType: "kpi" }>,
): echarts.EChartsOption {
  const theme = chartTheme(props);
  const count = Math.max(props.items.length, 1);
  return {
    ...baseOption(props),
    graphic: props.items.flatMap((item, index) => {
      const width = 1360 / count;
      const left = 120 + index * width;
      return [
        {
          type: "rect",
          shape: { x: left, y: 300, width: width - 24, height: 300, r: 14 },
          style: { fill: theme.panel, stroke: theme.border, lineWidth: 2 },
        },
        {
          type: "text",
          style: {
            x: left + (width - 24) / 2,
            y: 405,
            text: item.value,
            fill: theme.accent,
            fontFamily: TITLE_FONT,
            fontSize: 60,
            fontWeight: 700,
            textAlign: "center",
            textVerticalAlign: "middle",
          },
        },
        {
          type: "text",
          style: {
            x: left + (width - 24) / 2,
            y: 510,
            text: item.label,
            fill: theme.text,
            fontFamily: BODY_FONT,
            fontSize: 24,
            fontWeight: 500,
            textAlign: "center",
            textVerticalAlign: "middle",
          },
        },
      ];
    }),
  };
}

function buildOption(props: AnalyticsChartProps): echarts.EChartsOption {
  switch (props.chartType) {
    case "bar":
    case "stacked_bar":
    case "line":
    case "area":
      return cartesianOption(props);
    case "donut":
      return donutOption(props);
    case "scatter":
      return scatterOption(props);
    case "heatmap":
      return heatmapOption(props);
    case "radar":
      return radarOption(props);
    case "kpi":
      return kpiOption(props);
  }
}

export function analyticsChartToSvg(props: AnalyticsChartProps): string {
  return echartsOptionToSvg(buildOption(props), WIDTH, HEIGHT);
}

export function analyticsChartToImage(props: AnalyticsChartProps): Buffer {
  return echartsSvgToImage(
    analyticsChartToSvg(props),
    FONT_FILE_PATHS,
    BODY_FONT,
  );
}
