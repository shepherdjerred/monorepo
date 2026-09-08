import type { TemporalSeries } from "@scout-for-lol/data";

export function rankBumpSeries(series: TemporalSeries[]): TemporalSeries[] {
  const currentRanks = ranksByPointLabel(series, "value");
  const comparisonRanks = ranksByPointLabel(series, "comparisonValue");
  return series.map((item) => ({
    ...item,
    points: item.points.map((point) => {
      const currentRank = currentRanks.get(rankKey(item.id, point.label));
      const comparisonRank = comparisonRanks.get(rankKey(item.id, point.label));
      return {
        ...point,
        value: currentRank ?? null,
        comparisonValue:
          point.comparisonValue === undefined
            ? undefined
            : (comparisonRank ?? null),
        absoluteDelta:
          currentRank === undefined || comparisonRank === undefined
            ? null
            : currentRank - comparisonRank,
        percentageDelta: null,
      };
    }),
  }));
}

function ranksByPointLabel(
  series: TemporalSeries[],
  property: "value" | "comparisonValue",
): Map<string, number> {
  const labels = new Set(
    series.flatMap((item) => item.points.map((point) => point.label)),
  );
  const ranks = new Map<string, number>();
  for (const label of labels) {
    const entries = series
      .flatMap((item) => {
        const point = item.points.find(
          (candidate) => candidate.label === label,
        );
        const value = point?.[property];
        return typeof value === "number" ? [{ id: item.id, value }] : [];
      })
      .toSorted(
        (left, right) =>
          right.value - left.value || left.id.localeCompare(right.id),
      );
    let previousValue: number | undefined;
    let rank = 0;
    for (const [index, entry] of entries.entries()) {
      if (entry.value !== previousValue) rank = index + 1;
      ranks.set(rankKey(entry.id, label), rank);
      previousValue = entry.value;
    }
  }
  return ranks;
}

function rankKey(seriesId: string, pointLabel: string): string {
  return `${seriesId}\u{0}${pointLabel}`;
}
