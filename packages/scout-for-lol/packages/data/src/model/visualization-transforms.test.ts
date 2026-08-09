import { describe, expect, test } from "bun:test";
import {
  comparisonDeltas,
  cumulativeSeries,
  linearTrend,
  rollingSeries,
  wilsonInterval95,
} from "#src/model/visualization-transforms.ts";
import type { TemporalSeriesPoint } from "#src/model/temporal-analysis.ts";

function point(value: number | null, sampleSize: number): TemporalSeriesPoint {
  return {
    key: `${value === null ? "null" : value.toString()}:${sampleSize.toString()}`,
    label: "bucket",
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-01-01T23:59:59.999Z",
    value,
    evidence: { sampleSize, confidenceInterval: null },
  };
}

function comparedPoint(
  value: number,
  sampleSize: number,
  comparisonValue: number,
  comparisonSampleSize: number,
): TemporalSeriesPoint {
  return {
    ...point(value, sampleSize),
    comparisonValue,
    comparisonEvidence: {
      sampleSize: comparisonSampleSize,
      confidenceInterval: null,
    },
  };
}

function comparedRatePoint(
  successes: number,
  sampleSize: number,
  comparisonSuccesses: number,
  comparisonSampleSize: number,
): TemporalSeriesPoint {
  return {
    ...point(successes / sampleSize, sampleSize),
    comparisonValue: comparisonSuccesses / comparisonSampleSize,
    evidence: { sampleSize, successes, confidenceInterval: null },
    comparisonEvidence: {
      sampleSize: comparisonSampleSize,
      successes: comparisonSuccesses,
      confidenceInterval: null,
    },
  };
}

describe("visualization transforms", () => {
  test("computes Wilson 95 percent intervals for binary rates", () => {
    const interval = wilsonInterval95(5, 10);
    expect(interval?.lower).toBeCloseTo(0.2366, 3);
    expect(interval?.upper).toBeCloseTo(0.7634, 3);
    expect(wilsonInterval95(0, 0)).toBeNull();
  });

  test("returns an unknown percent delta for a zero baseline", () => {
    expect(comparisonDeltas(4, 0)).toEqual({
      absolute: 4,
      percentage: null,
    });
  });

  test("leaves leading rolling windows empty and weights rates by denominator", () => {
    const rolled = rollingSeries(
      [point(0.5, 2), point(0.75, 6), point(1, 2)],
      2,
      "rate",
    );
    expect(rolled[0]?.value).toBeNull();
    expect(rolled[1]?.value).toBeCloseTo(0.6875);
    expect(rolled[2]?.value).toBeCloseTo(0.8125);
  });

  test("uses a trailing average for additive metrics", () => {
    const rolled = rollingSeries(
      [point(2, 1), point(4, 1), point(9, 1)],
      2,
      "additive",
    );
    expect(rolled.map((item) => item.value)).toEqual([null, 3, 6.5]);
  });

  test("rolls comparison values, evidence, and deltas together", () => {
    const rolled = rollingSeries(
      [comparedPoint(2, 2, 1, 1), comparedPoint(4, 4, 3, 3)],
      2,
      "additive",
      true,
    );
    expect(rolled[0]).toMatchObject({
      value: null,
      comparisonValue: null,
      absoluteDelta: null,
      evidence: { sampleSize: 0 },
      comparisonEvidence: { sampleSize: 0 },
    });
    expect(rolled[1]).toMatchObject({
      value: 3,
      comparisonValue: 2,
      absoluteDelta: 1,
      percentageDelta: 0.5,
      evidence: { sampleSize: 6 },
      comparisonEvidence: { sampleSize: 4 },
    });
  });

  test("weights both sides of a rolling rate by their denominators", () => {
    const rolled = rollingSeries(
      [comparedRatePoint(1, 2, 1, 4), comparedRatePoint(5, 8, 3, 6)],
      2,
      "rate",
      true,
    );
    expect(rolled[1]).toMatchObject({
      value: 0.6,
      comparisonValue: 0.4,
      evidence: { sampleSize: 10, successes: 6 },
      comparisonEvidence: { sampleSize: 10, successes: 4 },
    });
    expect(rolled[1]?.absoluteDelta).toBeCloseTo(0.2);
    expect(rolled[1]?.percentageDelta).toBeCloseTo(0.5);
  });

  test("restricts cumulative transforms to additive metrics", () => {
    expect(
      cumulativeSeries([point(2, 1), point(null, 0), point(3, 1)], true).map(
        (item) => item.value,
      ),
    ).toEqual([2, 2, 5]);
    expect(() => cumulativeSeries([point(0.5, 2)], false)).toThrow(
      "additive metric",
    );
  });

  test("cumulates comparison values and recomputes deltas", () => {
    const cumulative = cumulativeSeries(
      [comparedPoint(2, 2, 1, 1), comparedPoint(3, 3, 4, 4)],
      true,
      true,
    );
    expect(cumulative[1]).toMatchObject({
      value: 5,
      comparisonValue: 5,
      absoluteDelta: 0,
      percentageDelta: 0,
      evidence: { sampleSize: 5 },
      comparisonEvidence: { sampleSize: 5 },
    });
  });

  test("fits a non-forecasting linear trend only with three points", () => {
    expect(linearTrend("games", [point(1, 1), point(2, 1)])).toBeNull();
    const trend = linearTrend("games", [point(1, 1), point(3, 1), point(5, 1)]);
    expect(trend?.slope).toBe(2);
    expect(trend?.rSquared).toBe(1);
    expect(trend?.values).toEqual([1, 3, 5]);
  });
});
