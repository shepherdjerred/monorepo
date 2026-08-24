import {
  TemporalAnalysisSpecSchema,
  type TemporalAnalysisSpec,
} from "#src/model/temporal-analysis.ts";

/**
 * The legacy `ANALYZE … BUCKET BY … COMPARE TO … IN TIME ZONE …` clause parser.
 *
 * `TemporalAnalysisSpec` itself is a live ScoutQL v2 contract — every
 * visualization snapshot carries one — so the schemas stay in
 * `model/temporal-analysis.ts`. Only the v1 clause syntax that used to produce
 * a spec is legacy, and it lives here because the boot-time migration's
 * independent route A compiles legacy text to a legacy plan.
 */
export function parseTemporalAnalysisClause(
  value: string,
): TemporalAnalysisSpec {
  const match = ANALYZE_PATTERN.exec(value.trim());
  const groups = match?.groups;
  if (groups === undefined) {
    throw new Error(
      "Invalid ANALYZE clause. Expected LAST <days> DAYS or BETWEEN '<date>' AND '<date>', followed by optional BUCKET, COMPARE, and IN TIME ZONE clauses.",
    );
  }
  const days = groups["days"];
  const startDate = groups["start"];
  const endDate = groups["end"];
  const comparisonStart = groups["comparisonStart"];
  const comparisonEnd = groups["comparisonEnd"];
  const comparesToPrevious = /\bcompare\s+to\s+previous\s+period\b/iu.test(
    value,
  );
  const window =
    days === undefined
      ? { kind: "calendar", startDate, endDate }
      : { kind: "relative", days: Number(days) };
  const comparison =
    comparisonStart !== undefined && comparisonEnd !== undefined
      ? {
          kind: "calendar",
          startDate: comparisonStart,
          endDate: comparisonEnd,
        }
      : comparesToPrevious
        ? { kind: "previous_period" }
        : undefined;
  return TemporalAnalysisSpecSchema.parse({
    window,
    bucket: groups["bucket"]?.toLowerCase() ?? "auto",
    comparison,
    timezone: groups["timezone"] ?? "UTC",
  });
}

const ANALYZE_PATTERN =
  /^(?:last\s+(?<days>\d+)\s+days?|between\s+'(?<start>\d{4}-\d{2}-\d{2})'\s+and\s+'(?<end>\d{4}-\d{2}-\d{2})')(?:\s+bucket\s+by\s+(?<bucket>auto|day|week|month|patch))?(?:\s+compare\s+to\s+(?:previous\s+period|between\s+'(?<comparisonStart>\d{4}-\d{2}-\d{2})'\s+and\s+'(?<comparisonEnd>\d{4}-\d{2}-\d{2})'))?(?:\s+in\s+time\s+zone\s+'(?<timezone>[^']+)')?$/iu;
