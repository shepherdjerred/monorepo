import {
  comparisonDeltas,
  isAdditiveReportExpression,
  resolveTemporalBucket,
  temporalWindowDays,
  type ReportQueryPlan,
} from "@scout-for-lol/data";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-types.ts";
import {
  comparePatchLabels,
  localCalendarDate,
} from "#src/reports/temporal-labels.ts";
import type { TemporalRange } from "#src/reports/temporal-range.ts";
import { addDays, addMonths, formatISO, parseISO } from "date-fns";

type TemporalComparisonInput = {
  currentRows: ReportResultRow[];
  comparisonRows: ReportResultRow[];
  comparisonEvidence: ReportQueryResult["evidence"];
  plan: ReportQueryPlan;
  ranges: { current: TemporalRange; comparison: TemporalRange | null };
};

export function attachTemporalComparison({
  currentRows,
  comparisonRows,
  comparisonEvidence,
  plan,
  ranges,
}: TemporalComparisonInput): {
  rows: ReportResultRow[];
  comparisonRows: ReportResultRow[];
} {
  const analysis = plan.analysis;
  const comparisonRange = ranges.comparison;
  if (analysis === undefined || comparisonRange === null) {
    throw new Error("Comparison attachment requires resolved temporal ranges.");
  }
  const bucket = resolveTemporalBucket(
    analysis.bucket,
    temporalWindowDays(analysis.window),
  );
  const currentPatchBuckets =
    bucket === "patch" ? orderedPatchBuckets(currentRows) : [];
  const comparisonPatchBuckets =
    bucket === "patch" ? orderedPatchBuckets(comparisonRows) : [];
  const currentPatchOffsets = new Map(
    currentPatchBuckets.map((label, index) => [label, index]),
  );
  const comparisonPatchOffsets = new Map(
    comparisonPatchBuckets.map((label, index) => [label, index]),
  );
  const currentGroups = groupTemporalRows(currentRows);
  const comparisonGroups = groupTemporalRows(comparisonRows);
  const comparisonEvidenceByRow = new Map(
    comparisonRows.map((row, index) => [row, comparisonEvidence?.[index]]),
  );
  const replacements = new Map<ReportResultRow, ReportResultRow>();
  const mergedRows = [...currentRows];
  const seriesKeys = new Set([
    ...currentGroups.keys(),
    ...comparisonGroups.keys(),
  ]);
  for (const seriesKey of seriesKeys) {
    const currentGroup = currentGroups.get(seriesKey) ?? [];
    const baselineGroup = comparisonGroups.get(seriesKey) ?? [];
    const compareRows =
      bucket === "patch" ? comparePatchTemporalRows : compareTemporalRows;
    const sortedCurrent = currentGroup.toSorted(compareRows);
    const sortedBaseline = baselineGroup.toSorted(compareRows);
    const baselineByOffset = new Map(
      sortedBaseline.map((row) => [
        temporalBucketOffset({
          row,
          range: comparisonRange,
          bucket,
          timezone: analysis.timezone,
          patchOffset: patchOffsetForRow(bucket, comparisonPatchOffsets, row),
        }),
        row,
      ]),
    );
    const currentByOffset = new Map(
      sortedCurrent.map((row) => [
        temporalBucketOffset({
          row,
          range: ranges.current,
          bucket,
          timezone: analysis.timezone,
          patchOffset: patchOffsetForRow(bucket, currentPatchOffsets, row),
        }),
        row,
      ]),
    );
    for (const offset of baselineByOffset.keys()) {
      if (currentByOffset.has(offset)) continue;
      const baseline = baselineByOffset.get(offset);
      if (baseline === undefined) continue;
      const currentPatchLabel = currentPatchBuckets[offset];
      if (bucket === "patch" && currentPatchLabel === undefined) continue;
      const row = materializeMissingCurrentRow({
        baseline,
        plan,
        range: ranges.current,
        bucket,
        timezone: analysis.timezone,
        offset,
        currentPatchLabel,
      });
      currentByOffset.set(offset, row);
      mergedRows.push(row);
    }
    for (const [offset, row] of currentByOffset) {
      const baseline = baselineByOffset.get(offset);
      replacements.set(row, {
        ...row,
        values: row.values.map((value) => {
          const matchedBaseline = baseline?.values.find(
            (candidate) => candidate.column === value.column,
          );
          const matchedBaselineEvidence =
            baseline === undefined
              ? undefined
              : comparisonEvidenceByRow
                  .get(baseline)
                  ?.values.find(
                    (candidate) => candidate.column === value.column,
                  );
          const baselineValue =
            matchedBaseline === undefined
              ? isAdditiveOutput(plan, value.column)
                ? 0
                : null
              : matchedBaseline.value;
          const numericBaseline =
            typeof baselineValue === "number" ? baselineValue : null;
          const numericValue =
            typeof value.value === "number" ? value.value : null;
          const deltas = comparisonDeltas(numericValue, numericBaseline);
          return {
            ...value,
            comparisonValue: baselineValue ?? null,
            absoluteDelta: deltas.absolute,
            percentageDelta: deltas.percentage,
            comparisonSampleSize: matchedBaselineEvidence?.sampleSize ?? 0,
            comparisonConfidenceInterval:
              matchedBaselineEvidence?.confidenceInterval ?? null,
            ...(matchedBaselineEvidence?.successes === undefined
              ? {}
              : { comparisonSuccesses: matchedBaselineEvidence.successes }),
            ...(matchedBaselineEvidence?.numerator === undefined
              ? {}
              : { comparisonNumerator: matchedBaselineEvidence.numerator }),
            ...(matchedBaselineEvidence?.denominator === undefined
              ? {}
              : {
                  comparisonDenominator: matchedBaselineEvidence.denominator,
                }),
          };
        }),
      });
    }
  }
  return {
    rows: mergedRows.map((row) => replacements.get(row) ?? row),
    comparisonRows,
  };
}

type MissingCurrentRowInput = {
  baseline: ReportResultRow;
  plan: ReportQueryPlan;
  range: TemporalRange;
  bucket: "day" | "week" | "month" | "patch";
  timezone: string;
  offset: number;
  currentPatchLabel: string | undefined;
};

function materializeMissingCurrentRow(
  input: MissingCurrentRowInput,
): ReportResultRow {
  const label = currentBucketLabel(input);
  const dimensions = [...input.baseline.dimensions.slice(0, -1), label];
  return {
    label: dimensions.join(" • "),
    dimensions,
    mentionIdentity: input.baseline.mentionIdentity,
    values: input.baseline.values.map((value) => ({
      column: value.column,
      value: isAdditiveOutput(input.plan, value.column) ? 0 : null,
    })),
  };
}

function currentBucketLabel(input: MissingCurrentRowInput): string {
  if (input.bucket === "patch") {
    if (input.currentPatchLabel === undefined) {
      throw new Error("Current period is missing its patch bucket label.");
    }
    return input.currentPatchLabel;
  }
  const startLabel = localCalendarDate(input.range.startDate, input.timezone);
  const start = parseISO(
    input.bucket === "month" ? `${startLabel.slice(0, 7)}-01` : startLabel,
  );
  const aligned =
    input.bucket === "week"
      ? addDays(start, -((start.getDay() + 6) % 7))
      : start;
  const date =
    input.bucket === "month"
      ? addMonths(aligned, input.offset)
      : addDays(aligned, input.offset * (input.bucket === "week" ? 7 : 1));
  return formatISO(date, {
    representation: "date",
  }).slice(0, input.bucket === "month" ? 7 : 10);
}

type TemporalBucketOffsetInput = {
  row: ReportResultRow;
  range: TemporalRange;
  bucket: "day" | "week" | "month" | "patch";
  timezone: string;
  patchOffset: number | undefined;
};

function temporalBucketOffset({
  row,
  range,
  bucket,
  timezone,
  patchOffset,
}: TemporalBucketOffsetInput): number {
  if (bucket === "patch") {
    if (patchOffset === undefined) {
      throw new Error("Temporal patch row is missing its period-wide offset.");
    }
    return patchOffset;
  }
  const label = row.dimensions.at(-1);
  if (label === undefined) {
    throw new Error("Temporal comparison row is missing its bucket label.");
  }
  const rangeLabel = localCalendarDate(range.startDate, timezone);
  const labelDate = new Date(
    Date.parse(bucket === "month" ? `${label}-01` : label),
  );
  const rangeDate = new Date(
    Date.parse(
      bucket === "month" ? `${rangeLabel.slice(0, 7)}-01` : rangeLabel,
    ),
  );
  if (bucket === "month") {
    return (
      (labelDate.getUTCFullYear() - rangeDate.getUTCFullYear()) * 12 +
      labelDate.getUTCMonth() -
      rangeDate.getUTCMonth()
    );
  }
  if (bucket === "week") {
    const daysSinceMonday = (rangeDate.getUTCDay() + 6) % 7;
    rangeDate.setUTCDate(rangeDate.getUTCDate() - daysSinceMonday);
  }
  const days = Math.round(
    (labelDate.getTime() - rangeDate.getTime()) / 86_400_000,
  );
  return bucket === "day" ? days : Math.floor(days / 7);
}

function orderedPatchBuckets(rows: ReportResultRow[]): string[] {
  const labels = new Set(
    rows.map((row) => requirePatchLabel(row.dimensions.at(-1))),
  );
  return [...labels].toSorted(comparePatchLabels);
}

function patchOffsetForRow(
  bucket: "day" | "week" | "month" | "patch",
  offsets: ReadonlyMap<string, number>,
  row: ReportResultRow,
): number | undefined {
  return bucket === "patch"
    ? offsets.get(requirePatchLabel(row.dimensions.at(-1)))
    : undefined;
}

function isAdditiveOutput(plan: ReportQueryPlan, column: string): boolean {
  const item = plan.selectItems.find((candidate) => candidate.key === column);
  return item !== undefined && isAdditiveReportExpression(item.expression);
}

function groupTemporalRows(
  rows: ReportResultRow[],
): Map<string, ReportResultRow[]> {
  const groups = new Map<string, ReportResultRow[]>();
  for (const row of rows) {
    const key = row.dimensions.slice(0, -1).join("\u{0}");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function compareTemporalRows(
  left: ReportResultRow,
  right: ReportResultRow,
): number {
  return (left.dimensions.at(-1) ?? "").localeCompare(
    right.dimensions.at(-1) ?? "",
  );
}

function comparePatchTemporalRows(
  left: ReportResultRow,
  right: ReportResultRow,
): number {
  return comparePatchLabels(
    requirePatchLabel(left.dimensions.at(-1)),
    requirePatchLabel(right.dimensions.at(-1)),
  );
}

function requirePatchLabel(label: string | undefined): string {
  if (label === undefined) {
    throw new Error("Temporal patch comparison row is missing its label.");
  }
  return label;
}
