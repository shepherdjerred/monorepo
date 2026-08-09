import { comparisonDeltas, type TemporalSeries } from "@scout-for-lol/data";

export function normalizePercentStack(
  series: TemporalSeries[],
): TemporalSeries[] {
  const totals = new Map<string, number>();
  const comparisonTotals = new Map<string, number>();
  for (const item of series) {
    for (const point of item.points) {
      totals.set(point.key, (totals.get(point.key) ?? 0) + (point.value ?? 0));
      if (point.comparisonValue !== undefined) {
        comparisonTotals.set(
          point.key,
          (comparisonTotals.get(point.key) ?? 0) + (point.comparisonValue ?? 0),
        );
      }
    }
  }
  return series.map((item) => ({
    ...item,
    points: item.points.map((point) => {
      const total = totals.get(point.key) ?? 0;
      const value = total === 0 ? null : (point.value ?? 0) / total;
      const normalizedEvidence = {
        evidence: { ...point.evidence, confidenceInterval: null },
        ...(point.comparisonEvidence === undefined
          ? {}
          : {
              comparisonEvidence:
                point.comparisonEvidence === null
                  ? null
                  : {
                      ...point.comparisonEvidence,
                      confidenceInterval: null,
                    },
            }),
      };
      if (point.comparisonValue === undefined) {
        return { ...point, ...normalizedEvidence, value };
      }
      const comparisonTotal = comparisonTotals.get(point.key) ?? 0;
      const comparisonValue =
        comparisonTotal === 0
          ? null
          : (point.comparisonValue ?? 0) / comparisonTotal;
      const deltas = comparisonDeltas(value, comparisonValue);
      return {
        ...point,
        ...normalizedEvidence,
        value,
        comparisonValue,
        absoluteDelta: deltas.absolute,
        percentageDelta: deltas.percentage,
      };
    }),
  }));
}
