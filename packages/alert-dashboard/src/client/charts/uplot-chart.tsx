import { useCallback, useMemo } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import {
  alignChartSeries,
  expandThresholdRange,
  legendIndividualValue,
  stackAlignedSeries,
  stackedSeriesBands,
  type AlignedChartData,
} from "./chart-data.ts";
import {
  barFillColor,
  CHART_CHROME,
  seriesColor,
  seriesFillColor,
  thresholdColor,
} from "./chart-palette.ts";
import { restingLegendIdxs } from "./legend-idxs.ts";
import { useResolvedTheme, type Theme } from "#client/theme.ts";
import { formatValue, type ValueUnit } from "#shared/ops-format";

export type ChartSeries = {
  name: string;
  points: readonly (readonly [number, number])[];
};

export type ChartMode = "line" | "stacked-area" | "bar";

export type ChartThreshold = {
  readonly value: number;
  readonly label: string;
  readonly tone?: "warning" | "error" | undefined;
};

export type UplotChartProps = {
  readonly series: readonly ChartSeries[];
  readonly unit: ValueUnit;
  readonly height?: number | undefined;
  readonly label: string;
  readonly mode?: ChartMode | undefined;
  readonly threshold?: ChartThreshold | undefined;
  readonly syncKey?: string | undefined;
};

const syncGroups = new Map<string, ReturnType<typeof uPlot.sync>>();

/** Shared uPlot crosshair sync bus keyed by `syncKey`. */
export function getChartSync(key: string): ReturnType<typeof uPlot.sync> {
  const existing = syncGroups.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = uPlot.sync(key);
  syncGroups.set(key, created);
  return created;
}

/** Join series on their timestamps; a missing sample is a gap, not zero. */
export function alignSeries(series: readonly ChartSeries[]): AlignedChartData {
  return alignChartSeries(series);
}

function drawThresholdOverlay(
  plot: uPlot,
  threshold: ChartThreshold,
  theme: Theme,
): void {
  const yPos = plot.valToPos(threshold.value, "y", true);
  if (!Number.isFinite(yPos)) {
    return;
  }
  const px = uPlot.pxRatio || 1;
  const { ctx, bbox } = plot;
  const y = Math.round(yPos) + 0.5;
  const color = thresholdColor(theme, threshold.tone ?? "warning");
  const nearTop = y - bbox.top < 16 * px;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.round(px));
  ctx.setLineDash([Math.round(4 * px), Math.round(3 * px)]);
  ctx.beginPath();
  ctx.moveTo(bbox.left, y);
  ctx.lineTo(bbox.left + bbox.width, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.font = `600 ${String(Math.round(10 * px))}px "Berkeley Mono", ui-monospace, monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = nearTop ? "top" : "bottom";
  ctx.fillText(
    threshold.label,
    bbox.left + bbox.width - 4 * px,
    nearTop ? y + 3 * px : y - 3 * px,
  );
  ctx.restore();
}

function buildSeriesOptions(options: {
  readonly series: readonly ChartSeries[];
  readonly rawData: AlignedChartData;
  readonly mode: ChartMode;
  readonly theme: Theme;
  readonly format: (value: number | null) => string;
}): uPlot.Series[] {
  const { series, rawData, mode, theme, format } = options;
  const barPaths =
    mode === "bar" ? uPlot.paths.bars?.({ size: [0.62, 44] }) : undefined;
  return [
    // The axis already carries the year; the legend's time stays short.
    { value: "{M}/{D} {h}:{mm}{aa}" },
    ...series.map((entry, index): uPlot.Series => {
      const stroke = seriesColor(theme, index);
      const base: uPlot.Series = {
        label: entry.name,
        stroke,
        width: mode === "bar" ? 1.5 : 2,
        points: { show: false },
        value: (_chart, _plotted, seriesIdx, dataIdx) =>
          format(legendIndividualValue(rawData, seriesIdx, dataIdx)),
      };
      if (mode === "stacked-area") {
        return {
          ...base,
          fill: seriesFillColor(theme, index),
          fillTo: 0,
        };
      }
      if (mode === "bar") {
        return {
          ...base,
          fill: barFillColor(theme, index),
          fillTo: 0,
          ...(barPaths === undefined ? {} : { paths: barPaths }),
        };
      }
      return base;
    }),
  ];
}

function buildYScale(
  mode: ChartMode,
  threshold: ChartThreshold | undefined,
): uPlot.Scale | undefined {
  if (threshold !== undefined) {
    return {
      range: (_plot, initMin, initMax) => {
        const floorMin =
          mode === "stacked-area" || mode === "bar"
            ? Math.min(0, initMin)
            : initMin;
        return expandThresholdRange(
          floorMin,
          initMax,
          threshold.value,
          (min, max, mult, extra) => uPlot.rangeNum(min, max, mult, extra),
        );
      },
    };
  }
  if (mode === "stacked-area" || mode === "bar") {
    return {
      range: {
        min: { soft: 0, mode: 1 },
        max: { pad: 0.1, soft: 0, mode: 3 },
      },
    };
  }
  return undefined;
}

/**
 * A thin React owner for one uPlot instance. The chart is created in a ref
 * callback (no effect), resized with a ResizeObserver, and rebuilt when the
 * data or the resolved theme changes so colors always match the page.
 *
 * The legend is live: it shows the hovered sample, and each series' newest
 * individual sample while nothing is hovered, so it never reads `--`.
 */
export function UplotChart({
  series,
  unit,
  height = 220,
  label,
  mode = "line",
  threshold,
  syncKey,
}: UplotChartProps): React.JSX.Element {
  const theme = useResolvedTheme();
  const rawData = useMemo(() => alignSeries(series), [series]);
  const plotData = useMemo(
    () => (mode === "stacked-area" ? stackAlignedSeries(rawData) : rawData),
    [mode, rawData],
  );
  const mount = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        return;
      }
      const chrome = CHART_CHROME[theme];
      const format = (value: number | null) => formatValue(value, unit);
      const axis = {
        stroke: chrome.axis,
        grid: { stroke: chrome.grid, width: 1 },
        ticks: { stroke: chrome.baseline, width: 1, size: 4 },
        font: "11px -apple-system, BlinkMacSystemFont, sans-serif",
      };
      const resting = restingLegendIdxs(rawData);
      const yScale = buildYScale(mode, threshold);
      const bands =
        mode === "stacked-area"
          ? stackedSeriesBands(series.length, (index) =>
              seriesFillColor(theme, index),
            )
          : undefined;
      const sync =
        syncKey === undefined
          ? undefined
          : { key: getChartSync(syncKey).key, setSeries: false };
      const drawHooks =
        threshold === undefined
          ? undefined
          : [
              (plot: uPlot) => {
                drawThresholdOverlay(plot, threshold, theme);
              },
            ];
      const chart = new uPlot(
        {
          width: Math.max(node.clientWidth, 240),
          height,
          cursor: {
            points: { size: mode === "bar" ? 6 : 8 },
            drag: { x: false, y: false },
            ...(sync === undefined ? {} : { sync }),
          },
          legend: {
            show: true,
            live: true,
            markers: {
              width: 0,
              fill: (_chart, index) => seriesColor(theme, index - 1),
            },
          },
          hooks: {
            // uPlot clears the legend whenever the cursor is off the plot:
            // on its first draw, on a resize, and when the pointer leaves.
            setCursor: [
              (plot) => {
                if (typeof plot.cursor.idx === "number") {
                  return;
                }
                plot.setLegend({ idxs: resting }, false);
                // `setLegend` also moves the cursor's own indexes. Clearing
                // them again keeps "nothing hovered" true, so hovering the
                // newest sample next still draws its point.
                plot.cursor.idxs?.fill(null);
              },
            ],
            ...(drawHooks === undefined ? {} : { draw: drawHooks }),
          },
          scales: {
            x: { time: true },
            ...(yScale === undefined ? {} : { y: yScale }),
          },
          ...(bands === undefined ? {} : { bands }),
          axes: [
            axis,
            {
              ...axis,
              size: 66,
              values: (_chart, splits) => splits.map((split) => format(split)),
            },
          ],
          series: buildSeriesOptions({
            series,
            rawData,
            mode,
            theme,
            format,
          }),
        },
        plotData,
        node,
      );
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width !== undefined && width > 0) {
          chart.setSize({ width: Math.max(width, 240), height });
        }
      });
      observer.observe(node);
      return () => {
        observer.disconnect();
        chart.destroy();
      };
    },
    [height, mode, plotData, rawData, series, syncKey, theme, threshold, unit],
  );
  return (
    <div
      className="uplot-host"
      ref={mount}
      role="img"
      aria-label={label}
      data-theme-chart={theme}
      data-chart-mode={mode}
    />
  );
}
