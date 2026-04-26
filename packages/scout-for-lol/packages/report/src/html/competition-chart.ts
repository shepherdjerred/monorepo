import * as echarts from "echarts";
import { fileURLToPath } from "node:url";
import { palette } from "#src/assets/colors.ts";
import { generateSeriesPalette } from "#src/html/competition-chart-palette.ts";

export type CompetitionChartSeries = {
  playerName: string;
  points: { date: Date; value: number | null }[];
};

export type CompetitionChartBar = {
  playerName: string;
  value: number;
};

export type CompetitionChartProps = {
  title: string;
  subtitle?: string;
  yAxisLabel: string;
} & (
  | {
      chartType: "line";
      series: CompetitionChartSeries[];
      startDate: Date;
      endDate: Date;
    }
  | {
      chartType: "bar";
      bars: CompetitionChartBar[];
    }
);

const WIDTH = 1600;
const HEIGHT = 900;

const TITLE_FONT = "Beaufort for LOL";
const BODY_FONT = "Spiegel";

/**
 * Always allocate enough distinct colors for a 10-player chart even when
 * fewer series are present — keeps rank-1's color stable across charts.
 */
const PALETTE_SIZE = 10;
const SERIES_PALETTE = generateSeriesPalette(PALETTE_SIZE);

/**
 * Symbol shape per series — cycles through 5 shapes so each color also gets
 * a unique silhouette. With 10 series, the first 5 get one line style and
 * the second 5 get a dashed variant, giving a unique (color, shape, dash)
 * tuple for every line.
 */
const SYMBOL_SHAPES = [
  "circle",
  "triangle",
  "rect",
  "diamond",
  "roundRect",
] as const;

/**
 * Solid for the top half, dashed for the bottom half. Ranks 1–5 stay calm
 * and easy to read; 6–10 get the dashed pattern so they're trivially
 * distinguishable from the leaders even before reading the legend.
 */
function lineDashFor(index: number): "solid" | "dashed" {
  return index < SYMBOL_SHAPES.length ? "solid" : "dashed";
}

function symbolFor(index: number): string {
  return SYMBOL_SHAPES[index % SYMBOL_SHAPES.length] ?? "circle";
}

const SPIEGEL_FONT_FILES = [
  "Spiegel-TTF/Spiegel_TT_Regular.ttf",
  "Spiegel-TTF/Spiegel_TT_Regular_Italic.ttf",
  "Spiegel-TTF/Spiegel_TT_SemiBold.ttf",
  "Spiegel-TTF/Spiegel_TT_SemiBold_Italic.ttf",
  "Spiegel-TTF/Spiegel_TT_Bold.ttf",
  "Spiegel-TTF/Spiegel_TT_Bold_Italic.ttf",
];

const BEAUFORT_FONT_FILES = [
  "BeaufortForLoL-TTF/BeaufortforLOL-Light.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-LightItalic.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Regular.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Italic.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Medium.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-MediumItalic.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Bold.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-BoldItalic.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-Heavy.ttf",
  "BeaufortForLoL-TTF/BeaufortforLOL-HeavyItalic.ttf",
];

const FONT_FILE_PATHS = [...SPIEGEL_FONT_FILES, ...BEAUFORT_FONT_FILES].map(
  (name) => fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url)),
);

const DAY_MS = 86_400_000;

function pickXAxisInterval(startDate: Date, endDate: Date): number {
  const days = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS),
  );
  if (days <= 7) {
    return DAY_MS;
  }
  if (days <= 60) {
    return 7 * DAY_MS;
  }
  if (days <= 180) {
    return 14 * DAY_MS;
  }
  return 30 * DAY_MS;
}

const BACKGROUND_GRADIENT = {
  type: "linear" as const,
  x: 0,
  y: 0,
  x2: 0,
  y2: 1,
  colorStops: [
    { offset: 0, color: palette.grey[6] },
    { offset: 0.5, color: palette.blue[6] },
    { offset: 1, color: palette.grey[6] },
  ],
};

function titleBlock(props: CompetitionChartProps) {
  return {
    text: props.title,
    ...(props.subtitle === undefined ? {} : { subtext: props.subtitle }),
    left: 40,
    top: 24,
    textStyle: {
      color: palette.gold.bright,
      fontSize: 44,
      fontWeight: 700,
      fontFamily: TITLE_FONT,
    },
    subtextStyle: {
      color: palette.grey[1],
      fontSize: 22,
      fontFamily: BODY_FONT,
      fontWeight: 400,
    },
  } as const;
}

function buildLineOption(
  props: Extract<CompetitionChartProps, { chartType: "line" }>,
): echarts.EChartsOption {
  const xInterval = pickXAxisInterval(props.startDate, props.endDate);
  return {
    animation: false,
    backgroundColor: BACKGROUND_GRADIENT,
    color: SERIES_PALETTE,
    textStyle: { color: palette.grey[1], fontFamily: BODY_FONT },
    title: titleBlock(props),
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 24,
      top: 110,
      bottom: 48,
      width: 320,
      itemWidth: 28,
      itemHeight: 16,
      itemGap: 14,
      textStyle: {
        color: palette.gold[1],
        fontSize: 22,
        fontFamily: BODY_FONT,
        fontWeight: 500,
      },
      pageTextStyle: {
        color: palette.gold.bright,
        fontFamily: BODY_FONT,
        fontSize: 18,
      },
      pageIconColor: palette.gold.bright,
      pageIconInactiveColor: palette.gold[5],
    },
    grid: {
      left: 96,
      right: 360,
      top: 160,
      bottom: 80,
      containLabel: true,
      show: true,
      borderColor: palette.gold[5],
      borderWidth: 2,
      backgroundColor: "transparent",
    },
    xAxis: {
      type: "time",
      min: props.startDate.getTime(),
      max: props.endDate.getTime(),
      interval: xInterval,
      minInterval: xInterval,
      axisLine: { lineStyle: { color: palette.gold[5], width: 1.5 } },
      axisTick: { lineStyle: { color: palette.gold[5] } },
      axisLabel: {
        color: palette.grey[1],
        fontSize: 22,
        fontFamily: BODY_FONT,
        hideOverlap: false,
        margin: 16,
        formatter: {
          year: "{yyyy}",
          month: "{MMM}",
          day: "{MMM} {d}",
          hour: "",
          minute: "",
          second: "",
        },
      },
      splitLine: {
        show: true,
        lineStyle: { color: palette.grey[5], type: "dashed" },
      },
    },
    yAxis: {
      type: "value",
      name: props.yAxisLabel,
      nameLocation: "middle",
      nameGap: 72,
      nameTextStyle: {
        color: palette.gold[2],
        fontSize: 24,
        fontFamily: TITLE_FONT,
        fontWeight: 700,
      },
      scale: true,
      axisLine: {
        show: true,
        lineStyle: { color: palette.gold[5], width: 1.5 },
      },
      axisTick: { lineStyle: { color: palette.gold[5] } },
      axisLabel: {
        color: palette.grey[1],
        fontSize: 22,
        fontFamily: BODY_FONT,
      },
      splitLine: { lineStyle: { color: palette.grey[5], type: "dashed" } },
    },
    series: props.series.map((s, index) => {
      const seriesColor =
        SERIES_PALETTE[index % SERIES_PALETTE.length] ?? palette.gold.bright;
      return {
        name: s.playerName,
        type: "line",
        showSymbol: true,
        symbol: symbolFor(index),
        symbolSize: 14,
        connectNulls: false,
        smooth: false,
        lineStyle: {
          width: index === 0 ? 4 : 3,
          type: lineDashFor(index),
        },
        itemStyle: {
          color: seriesColor,
          borderColor: palette.gold[5],
          borderWidth: 1.5,
        },
        data: s.points.map((p) => [p.date.getTime(), p.value]),
      };
    }),
  };
}

function buildBarOption(
  props: Extract<CompetitionChartProps, { chartType: "bar" }>,
): echarts.EChartsOption {
  // Sort descending so the leader is on top of the horizontal bar chart.
  const sortedBars = props.bars.toSorted((a, b) => b.value - a.value);

  // ECharts category axis with `inverse: true` puts the first array item
  // at the top — so we feed the data in ascending order (reversed) to get
  // the leader at the top.
  const categoryNames = sortedBars.map((b) => b.playerName).reverse();
  const values = sortedBars.map((b) => b.value).reverse();
  const colors = sortedBars
    .map(
      (_, i) =>
        SERIES_PALETTE[i % SERIES_PALETTE.length] ?? palette.gold.bright,
    )
    .reverse();

  return {
    animation: false,
    backgroundColor: BACKGROUND_GRADIENT,
    textStyle: { color: palette.grey[1], fontFamily: BODY_FONT },
    title: titleBlock(props),
    grid: {
      left: 32,
      right: 96,
      top: 160,
      bottom: 80,
      containLabel: true,
      show: true,
      borderColor: palette.gold[5],
      borderWidth: 2,
      backgroundColor: "transparent",
    },
    xAxis: {
      type: "value",
      name: props.yAxisLabel,
      nameLocation: "middle",
      nameGap: 48,
      nameTextStyle: {
        color: palette.gold[2],
        fontSize: 24,
        fontFamily: TITLE_FONT,
        fontWeight: 700,
      },
      axisLine: { lineStyle: { color: palette.gold[5], width: 1.5 } },
      axisTick: { lineStyle: { color: palette.gold[5] } },
      axisLabel: {
        color: palette.grey[1],
        fontSize: 22,
        fontFamily: BODY_FONT,
      },
      splitLine: {
        lineStyle: { color: palette.grey[5], type: "dashed" },
      },
    },
    yAxis: {
      type: "category",
      data: categoryNames,
      axisLine: { lineStyle: { color: palette.gold[5], width: 1.5 } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.gold[1],
        fontSize: 24,
        fontFamily: BODY_FONT,
        fontWeight: 500,
      },
    },
    series: [
      {
        type: "bar",
        data: values.map((value, i) => ({
          value,
          itemStyle: {
            color: colors[i] ?? palette.gold.bright,
            borderColor: palette.gold[5],
            borderWidth: 1.5,
            borderRadius: [0, 6, 6, 0],
          },
        })),
        barWidth: "60%",
        label: {
          show: true,
          position: "right",
          color: palette.gold[1],
          fontSize: 22,
          fontFamily: BODY_FONT,
          fontWeight: 700,
          distance: 12,
        },
      },
    ],
  };
}

function buildOption(props: CompetitionChartProps): echarts.EChartsOption {
  if (props.chartType === "bar") {
    return buildBarOption(props);
  }
  return buildLineOption(props);
}

export function competitionChartToSvg(props: CompetitionChartProps): string {
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: WIDTH,
    height: HEIGHT,
  });

  try {
    chart.setOption(buildOption(props));
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

export async function competitionChartToImage(
  props: CompetitionChartProps,
): Promise<Buffer> {
  const svg = competitionChartToSvg(props);
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILE_PATHS,
      defaultFontFamily: BODY_FONT,
    },
  });
  return resvg.render().asPng();
}
