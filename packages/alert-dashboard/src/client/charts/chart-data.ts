export type ChartSeriesInput = {
  readonly name: string;
  readonly points: readonly (readonly [number, number])[];
};

export type AlignedChartData = [number[], ...(number | null)[][]];

export type StackedBandBounds = {
  readonly series: [number, number];
  readonly fill: string;
};

/** Join series on their timestamps; a missing sample is a gap, not zero. */
export function alignChartSeries(
  series: readonly ChartSeriesInput[],
): AlignedChartData {
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
 * Cumulative upper-edge series for `stacked-area` plots. Timestamps where no
 * series has a sample remain `null` so gaps stay gaps; timestamps where at
 * least one series reports a value carry the running sum across missing series
 * so upper `uPlot.bands` never tear over partial gaps.
 */
export function stackAlignedSeries(
  aligned: AlignedChartData,
): AlignedChartData {
  const [xs, ...columns] = aligned;
  if (columns.length === 0) {
    return [xs];
  }
  const stacked: (number | null)[][] = columns.map(() => []);
  for (let pointIdx = 0; pointIdx < xs.length; pointIdx += 1) {
    const hasAnySample = columns.some((col) => col[pointIdx] !== null);
    let running = 0;
    for (const [seriesIdx, col] of columns.entries()) {
      const target = stacked[seriesIdx];
      if (target === undefined) {
        continue;
      }
      if (hasAnySample) {
        running += col[pointIdx] ?? 0;
        target.push(running);
      } else {
        target.push(null);
      }
    }
  }
  return [xs, ...stacked];
}

/**
 * Adjacent `uPlot.bands` pairing each upper cumulative series (`index + 1`)
 * with its lower neighbor (`index`), leaving series `1` to fill to `0`.
 */
export function stackedSeriesBands(
  seriesCount: number,
  fillAt: (seriesIndex: number) => string,
): StackedBandBounds[] {
  const bands: StackedBandBounds[] = [];
  for (let index = 1; index < seriesCount; index += 1) {
    bands.push({
      series: [index + 1, index],
      fill: fillAt(index),
    });
  }
  return bands;
}

/**
 * Reads a series's individual (un-stacked) value from the un-stacked aligned
 * table for the hover and resting legend, even when cumulative data is plotted.
 */
export function legendIndividualValue(
  rawAligned: AlignedChartData,
  seriesIdx: number,
  dataIdx: number | null,
): number | null {
  return dataIdx === null || seriesIdx < 1
    ? null
    : (rawAligned[seriesIdx]?.[dataIdx] ?? null);
}

/**
 * Expands the y-scale range so `thresholdValue` is always within `[min, max]`,
 * preserving uPlot's numeric padding when `rangeNum` supplies wider bounds.
 */
export function expandThresholdRange(
  initMin: number,
  initMax: number,
  thresholdValue: number,
  rangeNum: (
    min: number,
    max: number,
    mult: number,
    extra: boolean,
  ) => [number | null, number | null],
): [number, number] {
  const finiteBounds = Number.isFinite(initMin) && Number.isFinite(initMax);
  const baseMin = finiteBounds
    ? Math.min(initMin, thresholdValue)
    : Math.min(0, thresholdValue);
  const fallbackMax = thresholdValue === 0 ? 1 : thresholdValue * 1.1;
  const baseMax = finiteBounds
    ? Math.max(initMax, thresholdValue)
    : Math.max(0, thresholdValue, fallbackMax);
  const [paddedMin, paddedMax] = rangeNum(baseMin, baseMax, 0.1, true);
  const min = Math.min(paddedMin ?? baseMin, thresholdValue);
  const max = Math.max(paddedMax ?? baseMax, thresholdValue);
  return min === max ? [min - 1, max + 1] : [min, max];
}
