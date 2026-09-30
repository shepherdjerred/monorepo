import { useCallback, useMemo } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { CHART_CHROME, seriesColor } from "./chart-palette.ts";
import { useResolvedTheme } from "#client/theme.ts";
import { formatValue, type ValueUnit } from "#shared/ops-format";

export type ChartSeries = {
  name: string;
  points: readonly (readonly [number, number])[];
};

type AlignedData = [number[], ...(number | null)[][]];

/** Join series on their timestamps; a missing sample is a gap, not zero. */
export function alignSeries(series: readonly ChartSeries[]): AlignedData {
  const xs = [
    ...new Set(series.flatMap((entry) => entry.points.map(([x]) => x))),
  ].toSorted((left, right) => left - right);
  const columns = series.map((entry) => {
    const byX = new Map(entry.points.map(([x, y]) => [x, y]));
    return xs.map((x) => byX.get(x) ?? null);
  });
  return [xs, ...columns];
}

/**
 * A thin React owner for one uPlot instance. The chart is created in a ref
 * callback (no effect), resized with a ResizeObserver, and rebuilt when the
 * data or the resolved theme changes so colors always match the page.
 */
export function UplotChart({
  series,
  unit,
  height = 220,
  label,
}: {
  readonly series: readonly ChartSeries[];
  readonly unit: ValueUnit;
  readonly height?: number;
  readonly label: string;
}): React.JSX.Element {
  const theme = useResolvedTheme();
  const data = useMemo(() => alignSeries(series), [series]);
  const mount = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) return;
      const chrome = CHART_CHROME[theme];
      const format = (value: number | null) => formatValue(value, unit);
      const axis = {
        stroke: chrome.axis,
        grid: { stroke: chrome.grid, width: 1 },
        ticks: { stroke: chrome.baseline, width: 1, size: 4 },
        font: "11px -apple-system, BlinkMacSystemFont, sans-serif",
      };
      const chart = new uPlot(
        {
          width: Math.max(node.clientWidth, 240),
          height,
          cursor: { points: { size: 8 }, drag: { x: false, y: false } },
          legend: {
            show: true,
            live: true,
            markers: {
              width: 0,
              fill: (_chart, index) => seriesColor(theme, index - 1),
            },
          },
          scales: { x: { time: true } },
          axes: [
            axis,
            {
              ...axis,
              size: 56,
              values: (_chart, splits) => splits.map((split) => format(split)),
            },
          ],
          series: [
            {},
            ...series.map((entry, index) => ({
              label: entry.name,
              stroke: seriesColor(theme, index),
              width: 2,
              points: { show: false },
              value: (_chart: uPlot, value: number | null) => format(value),
            })),
          ],
        },
        data,
        node,
      );
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width !== undefined && width > 0)
          chart.setSize({ width: Math.max(width, 240), height });
      });
      observer.observe(node);
      return () => {
        observer.disconnect();
        chart.destroy();
      };
    },
    [data, height, series, theme, unit],
  );
  return (
    <div
      className="uplot-host"
      ref={mount}
      role="img"
      aria-label={label}
      data-theme-chart={theme}
    />
  );
}
