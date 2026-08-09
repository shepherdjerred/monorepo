import type {
  ConfidenceInterval,
  TemporalMetricEvidence,
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
  hasComparison = false,
): TemporalSeriesPoint[] {
  if (!Number.isInteger(windowSize) || windowSize < 2) {
    throw new Error("Rolling windows must contain at least two buckets.");
  }
  return points.map((point, index) => {
    if (index + 1 < windowSize) {
      return applyMeasures(
        point,
        emptyMeasure(),
        hasComparison ? emptyMeasure() : null,
      );
    }
    const window = points.slice(index + 1 - windowSize, index + 1);
    return applyMeasures(
      point,
      rollingMeasure(window, kind, false),
      hasComparison ? rollingMeasure(window, kind, true) : null,
    );
  });
}

export function cumulativeSeries(
  points: TemporalSeriesPoint[],
  additive: boolean,
  hasComparison = false,
): TemporalSeriesPoint[] {
  if (!additive) {
    throw new Error("Cumulative transforms require an additive metric.");
  }
  let total = 0;
  let comparisonTotal = 0;
  const evidence: TemporalMetricEvidence[] = [];
  const comparisonEvidence: TemporalMetricEvidence[] = [];
  return points.map((point) => {
    total += point.value ?? 0;
    evidence.push(point.evidence);
    const current = {
      value: total,
      evidence: combineEvidence(evidence, false),
    };
    if (!hasComparison) return applyMeasures(point, current, null);
    comparisonTotal += point.comparisonValue ?? 0;
    comparisonEvidence.push(
      point.comparisonEvidence ?? emptyMeasure().evidence,
    );
    return applyMeasures(point, current, {
      value: comparisonTotal,
      evidence: combineEvidence(comparisonEvidence, false),
    });
  });
}

type Measure = {
  value: number | null;
  evidence: TemporalMetricEvidence;
};

function rollingMeasure(
  points: TemporalSeriesPoint[],
  kind: "additive" | "rate" | "average",
  comparison: boolean,
): Measure {
  const values = points.map((point) =>
    comparison ? (point.comparisonValue ?? null) : point.value,
  );
  const evidence = points.map((point) =>
    comparison
      ? (point.comparisonEvidence ?? emptyMeasure().evidence)
      : point.evidence,
  );
  if (values.includes(null)) return emptyMeasure();
  const numericValues = values.flatMap((value) =>
    value === null ? [] : [value],
  );
  const combinedEvidence = combineEvidence(evidence, kind === "rate");
  if (kind === "additive") {
    return {
      value:
        numericValues.reduce((total, value) => total + value, 0) /
        points.length,
      evidence: combinedEvidence,
    };
  }
  if (
    kind === "rate" &&
    combinedEvidence.successes !== undefined &&
    combinedEvidence.sampleSize > 0
  ) {
    return {
      value: combinedEvidence.successes / combinedEvidence.sampleSize,
      evidence: combinedEvidence,
    };
  }
  if (combinedEvidence.sampleSize === 0) return emptyMeasure();
  const numerator = numericValues.reduce(
    (total, value, index) => total + value * (evidence[index]?.sampleSize ?? 0),
    0,
  );
  return {
    value: numerator / combinedEvidence.sampleSize,
    evidence: combinedEvidence,
  };
}

function combineEvidence(
  evidence: TemporalMetricEvidence[],
  confidence: boolean,
): TemporalMetricEvidence {
  const sampleSize = evidence.reduce(
    (total, item) => total + item.sampleSize,
    0,
  );
  const hasSuccesses = evidence.every((item) => item.successes !== undefined);
  if (!hasSuccesses) return { sampleSize, confidenceInterval: null };
  const successes = evidence.reduce(
    (total, item) => total + (item.successes ?? 0),
    0,
  );
  return {
    sampleSize,
    successes,
    confidenceInterval: confidence
      ? wilsonInterval95(successes, sampleSize)
      : null,
  };
}

function emptyMeasure(): Measure {
  return {
    value: null,
    evidence: { sampleSize: 0, confidenceInterval: null },
  };
}

function applyMeasures(
  point: TemporalSeriesPoint,
  current: Measure,
  comparison: Measure | null,
): TemporalSeriesPoint {
  if (comparison === null) {
    return { ...point, value: current.value, evidence: current.evidence };
  }
  const deltas = comparisonDeltas(current.value, comparison.value);
  return {
    ...point,
    value: current.value,
    comparisonValue: comparison.value,
    absoluteDelta: deltas.absolute,
    percentageDelta: deltas.percentage,
    evidence: current.evidence,
    comparisonEvidence: comparison.evidence,
  };
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
