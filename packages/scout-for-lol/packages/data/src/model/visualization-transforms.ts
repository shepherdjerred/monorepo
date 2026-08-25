import type {
  TemporalMetricEvidence,
  TemporalSeriesPoint,
  VisualizationTrend,
} from "#src/model/temporal-analysis.ts";

export function evidenceGames(evidence: TemporalMetricEvidence): number {
  // Historical snapshots predate canonical game counts. Their metric sample
  // size is the only available basis and preserves the old display meaning.
  return evidence.games ?? evidence.sampleSize;
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
      evidence: combineEvidence(evidence),
    };
    if (!hasComparison) return applyMeasures(point, current, null);
    comparisonTotal += point.comparisonValue ?? 0;
    comparisonEvidence.push(
      point.comparisonEvidence ?? emptyMeasure().evidence,
    );
    return applyMeasures(point, current, {
      value: comparisonTotal,
      evidence: combineEvidence(comparisonEvidence),
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
  const samples = points
    .map((point) => ({
      value: comparison ? (point.comparisonValue ?? null) : point.value,
      evidence: comparison
        ? (point.comparisonEvidence ?? emptyMeasure().evidence)
        : point.evidence,
    }))
    .filter(
      (sample) => !(sample.value === null && sample.evidence.sampleSize === 0),
    );
  if (samples.length === 0 || samples.some((sample) => sample.value === null)) {
    return emptyMeasure();
  }
  const numericValues = samples.flatMap((sample) =>
    sample.value === null ? [] : [sample.value],
  );
  const evidence = samples.map((sample) => sample.evidence);
  const combinedEvidence = combineEvidence(evidence);
  if (kind === "additive") {
    return {
      value:
        numericValues.reduce((total, value) => total + value, 0) /
        samples.length,
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
  if (
    combinedEvidence.numerator !== undefined &&
    combinedEvidence.denominator !== undefined
  ) {
    return {
      value:
        combinedEvidence.denominator === 0
          ? combinedEvidence.numerator
          : combinedEvidence.numerator / combinedEvidence.denominator,
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
): TemporalMetricEvidence {
  const games = evidence.reduce(
    (total, item) => total + evidenceGames(item),
    0,
  );
  const sampleSize = evidence.reduce(
    (total, item) => total + item.sampleSize,
    0,
  );
  const hasSuccesses = evidence.every((item) => item.successes !== undefined);
  const hasRatio = evidence.every(
    (item) => item.numerator !== undefined && item.denominator !== undefined,
  );
  const ratio = hasRatio
    ? {
        numerator: evidence.reduce(
          (total, item) => total + (item.numerator ?? 0),
          0,
        ),
        denominator: evidence.reduce(
          (total, item) => total + (item.denominator ?? 0),
          0,
        ),
      }
    : {};
  if (!hasSuccesses) {
    return { games, sampleSize, ...ratio };
  }
  const successes = evidence.reduce(
    (total, item) => total + (item.successes ?? 0),
    0,
  );
  return {
    games,
    sampleSize,
    successes,
    ...ratio,
  };
}

function emptyMeasure(): Measure {
  return {
    value: null,
    evidence: { games: 0, sampleSize: 0 },
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
