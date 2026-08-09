import {
  REPORT_METRICS,
  collectExpressionMetrics,
  comparisonDeltas,
  resolveTemporalBucket,
  temporalWindowDays,
  type ReportQueryPlan,
} from "@scout-for-lol/data";
import type { ReportResultRow } from "#src/reports/query-engine.ts";
import type { TemporalRange } from "#src/reports/temporal-range.ts";

type TemporalComparisonInput = {
  currentRows: ReportResultRow[];
  comparisonRows: ReportResultRow[];
  plan: ReportQueryPlan;
  ranges: { current: TemporalRange; comparison: TemporalRange | null };
};

export function attachTemporalComparison({
  currentRows,
  comparisonRows,
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
  const currentGroups = groupTemporalRows(currentRows);
  const comparisonGroups = groupTemporalRows(comparisonRows);
  const replacements = new Map<ReportResultRow, ReportResultRow>();
  for (const [seriesKey, currentGroup] of currentGroups) {
    const baselineGroup = comparisonGroups.get(seriesKey) ?? [];
    const compareRows =
      bucket === "patch" ? comparePatchTemporalRows : compareTemporalRows;
    const sortedCurrent = currentGroup.toSorted(compareRows);
    const sortedBaseline = baselineGroup.toSorted(compareRows);
    const baselineByOffset = new Map(
      sortedBaseline.map((row, index) => [
        temporalBucketOffset({
          row,
          range: comparisonRange,
          bucket,
          timezone: analysis.timezone,
          patchIndex: index,
        }),
        row,
      ]),
    );
    sortedCurrent.forEach((row, index) => {
      const offset = temporalBucketOffset({
        row,
        range: ranges.current,
        bucket,
        timezone: analysis.timezone,
        patchIndex: index,
      });
      const baseline = baselineByOffset.get(offset);
      replacements.set(row, {
        ...row,
        values: row.values.map((value) => {
          const matchedBaseline = baseline?.values.find(
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
          };
        }),
      });
    });
  }
  return {
    rows: currentRows.map((row) => replacements.get(row) ?? row),
    comparisonRows,
  };
}

type TemporalBucketOffsetInput = {
  row: ReportResultRow;
  range: TemporalRange;
  bucket: "day" | "week" | "month" | "patch";
  timezone: string;
  patchIndex: number;
};

function temporalBucketOffset({
  row,
  range,
  bucket,
  timezone,
  patchIndex,
}: TemporalBucketOffsetInput): number {
  if (bucket === "patch") return patchIndex;
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

function localCalendarDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not format temporal range in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}

function isAdditiveOutput(plan: ReportQueryPlan, column: string): boolean {
  const item = plan.selectItems.find((candidate) => candidate.key === column);
  if (item === undefined) return false;
  const metrics = collectExpressionMetrics(item.expression);
  return (
    metrics.length > 0 &&
    metrics.every((metric) =>
      REPORT_METRICS.some(
        (candidate) => candidate.id === metric && candidate.kind === "count",
      ),
    )
  );
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
  const leftPatch = patchParts(left.dimensions.at(-1));
  const rightPatch = patchParts(right.dimensions.at(-1));
  return (
    leftPatch.major - rightPatch.major || leftPatch.minor - rightPatch.minor
  );
}

function patchParts(label: string | undefined): {
  major: number;
  minor: number;
} {
  const groups =
    label === undefined
      ? undefined
      : /^(?<major>\d+)\.(?<minor>\d+)$/u.exec(label)?.groups;
  if (groups === undefined) {
    throw new Error(`Invalid temporal patch bucket ${label ?? "<missing>"}.`);
  }
  return { major: Number(groups["major"]), minor: Number(groups["minor"]) };
}
