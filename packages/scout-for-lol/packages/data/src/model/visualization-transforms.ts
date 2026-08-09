import type {
  ConfidenceInterval,
  TemporalSeriesPoint,
  VisualizationTrend,
} from "#src/model/temporal-analysis.ts";

export function wilsonInterval95(
  successes: number,
  sampleSize: number,
): ConfidenceInterval | null {
  if (sampleSize === 0) return null;
  if (successes < 0 || successes > sampleSize) {
    throw new Error(
      "Wilson interval successes must be between zero and the sample size.",
    );
  }
  const z = 1.959963984540054;
  const proportion = successes / sampleSize;
  const denominator = 1 + (z * z) / sampleSize;
  const center = (proportion + (z * z) / (2 * sampleSize)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / sampleSize +
        (z * z) / (4 * sampleSize * sampleSize),
    );
  return {
    level: 0.95,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function comparisonDeltas(
  value: number | null,
  baseline: number | null,
): { absolute: number | null; percentage: number | null } {
  if (value === null || baseline === null) {
    return { absolute: null, percentage: null };
  }
  const absolute = value - baseline;
  return {
    absolute,
    percentage: baseline === 0 ? null : absolute / Math.abs(baseline),
  };
}

export function rollingSeries(
  points: TemporalSeriesPoint[],
  windowSize: number,
  kind: "additive" | "rate" | "average",
): TemporalSeriesPoint[] {
  if (!Number.isInteger(windowSize) || windowSize < 2) {
    throw new Error("Rolling windows must contain at least two buckets.");
  }
  return points.map((point, index) => {
    if (index + 1 < windowSize) return { ...point, value: null };
    const window = points.slice(index + 1 - windowSize, index + 1);
    if (window.some((candidate) => candidate.value === null)) {
      return { ...point, value: null };
    }
    if (kind === "additive") {
      return {
        ...point,
        value:
          window.reduce(
            (total, candidate) => total + (candidate.value ?? 0),
            0,
          ) / windowSize,
      };
    }
    const denominator = window.reduce(
      (total, candidate) => total + candidate.evidence.sampleSize,
      0,
    );
    if (denominator === 0) return { ...point, value: null };
    const numerator = window.reduce(
      (total, candidate) =>
        total + (candidate.value ?? 0) * candidate.evidence.sampleSize,
      0,
    );
    return { ...point, value: numerator / denominator };
  });
}

export function cumulativeSeries(
  points: TemporalSeriesPoint[],
  additive: boolean,
): TemporalSeriesPoint[] {
  if (!additive) {
    throw new Error("Cumulative transforms require an additive metric.");
  }
  let total = 0;
  return points.map((point) => {
    total += point.value ?? 0;
    return { ...point, value: total };
  });
}

export function linearTrend(
  seriesId: string,
  points: TemporalSeriesPoint[],
): VisualizationTrend | null {
  const samples = points.flatMap((point, index) =>
    point.value === null ? [] : [{ x: index, y: point.value }],
  );
  if (samples.length < 3) return null;
  const xMean =
    samples.reduce((sum, sample) => sum + sample.x, 0) / samples.length;
  const yMean =
    samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length;
  const covariance = samples.reduce(
    (sum, sample) => sum + (sample.x - xMean) * (sample.y - yMean),
    0,
  );
  const xVariance = samples.reduce(
    (sum, sample) => sum + (sample.x - xMean) ** 2,
    0,
  );
  const slope = covariance / xVariance;
  const intercept = yMean - slope * xMean;
  const totalVariation = samples.reduce(
    (sum, sample) => sum + (sample.y - yMean) ** 2,
    0,
  );
  const residualVariation = samples.reduce(
    (sum, sample) => sum + (sample.y - (intercept + slope * sample.x)) ** 2,
    0,
  );
  const rSquared =
    totalVariation === 0 ? 1 : 1 - residualVariation / totalVariation;
  return {
    seriesId,
    slope,
    rSquared: Math.max(0, Math.min(1, rSquared)),
    values: points.map((_point, index) => intercept + slope * index),
  };
}
