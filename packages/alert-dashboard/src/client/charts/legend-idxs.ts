/**
 * The data index a legend shows for each series while nothing is hovered:
 * that series' newest sample, or `null` when it has none. `data` is uPlot's
 * aligned shape, the x values first; the x entry is the newest index any
 * series has a sample at, so the legend's time is never ahead of its values.
 */
export function restingLegendIdxs(
  data: readonly (readonly (number | null)[])[],
): (number | null)[] {
  const series = data.slice(1).map((column) => {
    const index = column.findLastIndex((value) => value !== null);
    return index === -1 ? null : index;
  });
  const newest = series.reduce<number | null>(
    (latest, index) =>
      index !== null && (latest === null || index > latest) ? index : latest,
    null,
  );
  return [newest, ...series];
}
