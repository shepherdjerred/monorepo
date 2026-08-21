import {
  formatReportDisplayValue,
  REPORT_METRICS,
  type ReportAiPreviewSummary,
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

const MAX_NATIVE_CELL_LENGTH = 160;
const nativeCellGraphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export type NativeRowValue = string | number | null;
export type NativeRow = {
  key: string;
  label: string;
  values: Map<string, NativeRowValue>;
};

export function truncateNativeCell(
  value: string,
  maxLength = MAX_NATIVE_CELL_LENGTH,
): string {
  if (value.length <= maxLength) {
    return value;
  }
  let truncated = "";
  for (const { segment } of nativeCellGraphemeSegmenter.segment(value)) {
    if (truncated.length + segment.length > maxLength - 1) {
      break;
    }
    truncated += segment;
  }
  return `${truncated}…`;
}

const displayWidthGraphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export function displayWidth(value: string): number {
  let width = 0;
  for (const { segment } of displayWidthGraphemeSegmenter.segment(value)) {
    width += displayGraphemeWidth(segment);
  }
  return width;
}

function displayGraphemeWidth(segment: string): number {
  let width = 0;
  let regionalIndicatorCount = 0;
  let hasKeycapMark = false;
  let hasEmojiVariationSelector = false;
  for (const character of segment) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint >= 0x1_f1_e6 && codePoint <= 0x1_f1_ff) {
      regionalIndicatorCount += 1;
      continue;
    }
    if (codePoint === 0x20_0d) {
      continue;
    }
    if (codePoint === 0x20_e3) {
      hasKeycapMark = true;
      continue;
    }
    if (codePoint === 0xfe_0f) {
      hasEmojiVariationSelector = true;
      continue;
    }
    if (
      /\p{Mark}/u.test(character) ||
      (codePoint >= 0xfe_00 && codePoint <= 0xfe_0e)
    ) {
      continue;
    }
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }
  return hasKeycapMark ||
    hasEmojiVariationSelector ||
    regionalIndicatorCount === 2
    ? 2
    : width;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x11_00 && codePoint <= 0x11_5f) ||
    codePoint === 0x23_29 ||
    codePoint === 0x23_2a ||
    (codePoint >= 0x2e_80 && codePoint <= 0xa4_cf) ||
    (codePoint >= 0xac_00 && codePoint <= 0xd7_a3) ||
    (codePoint >= 0xf9_00 && codePoint <= 0xfa_ff) ||
    (codePoint >= 0xfe_10 && codePoint <= 0xfe_19) ||
    (codePoint >= 0xfe_30 && codePoint <= 0xfe_6f) ||
    (codePoint >= 0xff_00 && codePoint <= 0xff_60) ||
    (codePoint >= 0xff_e0 && codePoint <= 0xff_e6) ||
    (codePoint >= 0x1_f3_00 && codePoint <= 0x1_fa_ff)
  );
}

export function padDisplayWidth(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

export function formatPreviewValue(
  column: ReportAiPreviewSummary["columns"][number],
  value: NativeRowValue,
): string {
  return value === null ? "Unknown" : formatReportDisplayValue(column, value);
}

export function formatPreviewValueWithEvidence(
  snapshot: VisualizationSnapshot,
  column: ReportAiPreviewSummary["columns"][number],
  row: NativeRow,
): string {
  const value = formatPreviewValue(column, requireRowValue(row, column.key));
  const seriesMatches = snapshot.series.flatMap((item) => {
    if (item.metric !== column.key) {
      return [];
    }
    const separator = item.id.lastIndexOf(":");
    const seriesDimension =
      separator === -1 ? "All" : item.id.slice(0, separator);
    if (seriesDimension === "All") {
      const point = item.points.find((candidate) =>
        pointMatchesRow(candidate, row, null),
      );
      return point === undefined ? [] : [{ item, point, specificity: 0 }];
    }
    if (!row.key.startsWith(`${seriesDimension} • `)) {
      return [];
    }
    const point = item.points.find((candidate) =>
      pointMatchesNamedSeries(candidate, row, seriesDimension),
    );
    return point === undefined
      ? []
      : [{ item, point, specificity: seriesDimension.length }];
  });
  const seriesMatch = seriesMatches.sort(
    (left, right) => right.specificity - left.specificity,
  )[0];
  if (seriesMatch === undefined) {
    return value;
  }
  return `${value}${formatConfidenceInterval(
    snapshot,
    seriesMatch.item,
    seriesMatch.point,
  )}`;
}

function pointMatchesNamedSeries(
  point: TemporalSeries["points"][number],
  row: NativeRow,
  seriesDimension: string,
): boolean {
  return (
    row.key === `${seriesDimension} • ${point.key}` ||
    row.key === `${seriesDimension} • ${point.label}` ||
    row.label === `${seriesDimension} • ${point.key}` ||
    row.label === `${seriesDimension} • ${point.label}`
  );
}

function pointMatchesRow(
  point: TemporalSeries["points"][number],
  row: NativeRow,
  pointDimension: string | null,
): boolean {
  if (
    point.key === row.key ||
    point.key === row.label ||
    point.label === row.key ||
    point.label === row.label
  ) {
    return true;
  }
  if (pointDimension === null) {
    return false;
  }
  const dimension = pointDimension;
  return (
    displayDimensionMatches(dimension, point.key) ||
    displayDimensionMatches(dimension, point.label)
  );
}

function displayDimensionMatches(value: string, dimension: string): boolean {
  return (
    value === dimension ||
    value.startsWith(`${dimension} • `) ||
    value.endsWith(` • ${dimension}`) ||
    value.includes(` • ${dimension} • `)
  );
}

export function requireRowValue(
  row: NativeRow,
  column: string,
): NativeRowValue {
  const value = row.values.get(column);
  if (value === undefined) {
    throw new Error(`Visualization row missing value for ${column}.`);
  }
  return value;
}

export function formatNativeSeriesValue(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  row: NativeRow,
): string {
  const value = formatSeriesValue(
    snapshot,
    series,
    requireNumericRowValue(row, series.id),
  );
  const point = series.points.find((item) => item.key === row.key);
  const confidenceIntervalText = formatConfidenceInterval(
    snapshot,
    series,
    point,
  );
  if (
    point === undefined ||
    (snapshot.temporal?.comparison === undefined &&
      point.comparisonEvidence === undefined)
  ) {
    return `${value}${confidenceIntervalText}`;
  }
  const percentage = point.percentageDelta;
  return `${value}${confidenceIntervalText} · Baseline: ${formatSeriesValue(
    snapshot,
    series,
    point.comparisonValue ?? null,
  )} · Δ ${formatAbsoluteDelta(snapshot, series, point.absoluteDelta ?? null)} · ${
    percentage === null || percentage === undefined
      ? "Unknown"
      : `${(percentage * 100).toFixed(1)}%`
  }`;
}

function formatConfidenceInterval(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  point: TemporalSeries["points"][number] | undefined,
): string {
  const confidenceInterval = point?.evidence.confidenceInterval;
  return confidenceInterval === null || confidenceInterval === undefined
    ? ""
    : ` · 95% CI ${formatSeriesValue(
        snapshot,
        series,
        confidenceInterval.lower,
      )}–${formatSeriesValue(snapshot, series, confidenceInterval.upper)}`;
}

export function formatSeriesValue(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  if (value === null) {
    return "Unknown";
  }
  const isRate =
    snapshot.display.stack === "percent" ||
    REPORT_METRICS.find((metric) => metric.id === series.metric)?.kind ===
      "rate";
  if (isRate) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
    value,
  );
}

export function formatAbsoluteDelta(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  const isRate =
    snapshot.display.stack === "percent" ||
    REPORT_METRICS.find((metric) => metric.id === series.metric)?.kind ===
      "rate";
  return isRate
    ? value === null
      ? "Unknown"
      : `${(value * 100).toFixed(1)} pp`
    : formatSeriesValue(snapshot, series, value);
}

export function requireNumericRowValue(
  row: NativeRow,
  column: string,
): number | null {
  const value = row.values.get(column) ?? null;
  if (typeof value !== "number" && value !== null) {
    throw new Error(`Visualization row value for ${column} is not numeric.`);
  }
  return value;
}
