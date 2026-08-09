import type { TemporalAnalysisSpec } from "#src/model/temporal-analysis.ts";
import {
  formatTemporalAnalysis,
  parseTemporalAnalysisClause,
} from "#src/model/temporal-analysis.ts";
import { formatReportQuery } from "#src/model/report-query-format.ts";
import { parseReportQuery } from "#src/model/report-query-parser.ts";

export function reportTemporalAnalysis(
  queryText: string,
): TemporalAnalysisSpec | null {
  const analysis = parseReportQuery(queryText).ast.analysis;
  return analysis === undefined
    ? null
    : parseTemporalAnalysisClause(analysis.value);
}

export function replaceReportTemporalAnalysis(
  queryText: string,
  analysis: TemporalAnalysisSpec | null,
): string {
  const formatted = formatReportQuery(queryText);
  const lines = formatted
    .split("\n")
    .filter(
      (line) =>
        !/^\s*(?:analyze|bucket\s+by|compare\s+to|in\s+time\s+zone)\b/iu.test(
          line,
        ),
    );
  if (analysis === null) return lines.join("\n");
  const insertion = lines.findIndex((line) =>
    /^\s*(?:order\s+by|limit|render)\b/iu.test(line),
  );
  const temporalLines = formatTemporalAnalysis(analysis);
  if (insertion === -1) return [...lines, ...temporalLines].join("\n");
  return [
    ...lines.slice(0, insertion),
    ...temporalLines,
    ...lines.slice(insertion),
  ].join("\n");
}
