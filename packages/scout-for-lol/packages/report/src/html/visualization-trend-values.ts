import type { VisualizationSnapshot } from "@scout-for-lol/data";

export function alignedTrendValues(
  snapshot: VisualizationSnapshot,
  trend: VisualizationSnapshot["trends"][number],
  categories: string[],
): (number | null)[] {
  const source = snapshot.series.find((series) => series.id === trend.seriesId);
  if (source === undefined) return categories.map(() => null);
  const valueByLabel = new Map(
    source.points.map((point, index) => [
      point.label,
      trend.values[index] ?? null,
    ]),
  );
  return categories.map((category) => valueByLabel.get(category) ?? null);
}
