export type CoverageMetric = {
  covered: number;
  total: number;
};

export type CoverageMetricName =
  | "lines"
  | "statements"
  | "functions"
  | "branches";

export type CoverageMetrics = {
  lines?: CoverageMetric;
  statements?: CoverageMetric;
  functions?: CoverageMetric;
  branches?: CoverageMetric;
  unavailableMetrics?: readonly CoverageMetricName[];
};

const unitCoverageWeight = 1;
const coverageMetricNames = [
  "lines",
  "statements",
  "functions",
  "branches",
] satisfies readonly CoverageMetricName[];

export type CoveragePoint = {
  metric: CoverageMetricName;
  source: string;
  location: string;
  covered: boolean;
  weight: number;
  identity?: "anonymous-summary";
};

export type CoverageReport = {
  points: readonly CoveragePoint[];
  unavailableMetrics?: readonly CoverageMetricName[];
};

export function coveragePercentage(metric: CoverageMetric): number {
  return metric.total === 0 ? 100 : (metric.covered / metric.total) * 100;
}

function pointKey(point: CoveragePoint): string {
  return [point.metric, point.source, point.location].join("\u{0}");
}

function addCoveragePoint(
  points: Map<string, CoveragePoint>,
  point: CoveragePoint,
): void {
  const key = pointKey(point);
  const existing = points.get(key);
  if (existing !== undefined && existing.weight !== point.weight) {
    throw new Error(`Coverage point ${key} has inconsistent weights`);
  }
  points.set(key, {
    ...point,
    covered: point.covered || existing?.covered === true,
  });
}

function requireLcovSource(source: string | undefined, line: string): string {
  if (source === undefined) {
    throw new Error(`LCOV record appears before its source: ${line}`);
  }
  return source;
}

function parseLcovLineDetail(
  trimmed: string,
  source: string | undefined,
  points: Map<string, CoveragePoint>,
): boolean {
  const match = /^DA:(\d+),(\d+)(?:,.*)?$/.exec(trimmed);
  if (match?.[1] === undefined || match[2] === undefined) {
    return false;
  }
  const lineNumber = match[1];
  const hitCount = Number.parseInt(match[2], 10);
  addCoveragePoint(points, {
    metric: "lines",
    source: requireLcovSource(source, trimmed),
    location: lineNumber,
    covered: hitCount > 0,
    weight: unitCoverageWeight,
  });
  return true;
}

type LcovFunctionState = {
  definitions: Map<string, string[]>;
  nextCoverageIndex: Map<string, number>;
};

type LcovMetricTotals = {
  covered?: number;
  total?: number;
};

type LcovSummaryState = {
  lines: LcovMetricTotals;
  functions: LcovMetricTotals;
  branches: LcovMetricTotals;
};

function emptyLcovSummaryState(): LcovSummaryState {
  return {
    lines: {},
    functions: {},
    branches: {},
  };
}

function parseLcovFunctionDefinition(
  trimmed: string,
  source: string | undefined,
  points: Map<string, CoveragePoint>,
  state: LcovFunctionState,
): boolean {
  const match = /^FN:(\d+),(.*)$/.exec(trimmed);
  if (match?.[1] === undefined || match[2] === undefined) {
    return false;
  }
  const location = `${match[1]}:${match[2]}`;
  const definitions = state.definitions.get(match[2]) ?? [];
  definitions.push(location);
  state.definitions.set(match[2], definitions);
  addCoveragePoint(points, {
    metric: "functions",
    source: requireLcovSource(source, trimmed),
    location,
    covered: false,
    weight: 1,
  });
  return true;
}

function parseLcovFunctionCoverage(
  trimmed: string,
  source: string | undefined,
  points: Map<string, CoveragePoint>,
  state: LcovFunctionState,
): boolean {
  const match = /^FNDA:(\d+),(.*)$/.exec(trimmed);
  if (match?.[1] === undefined || match[2] === undefined) {
    return false;
  }
  const functionName = match[2];
  const currentSource = requireLcovSource(source, trimmed);
  const coverageIndex = state.nextCoverageIndex.get(functionName) ?? 0;
  const definition = state.definitions.get(functionName)?.[coverageIndex];
  state.nextCoverageIndex.set(functionName, coverageIndex + 1);
  addCoveragePoint(points, {
    metric: "functions",
    source: currentSource,
    location: definition ?? `${functionName}#${coverageIndex.toString()}`,
    covered: Number.parseInt(match[1], 10) > 0,
    weight: 1,
  });
  return true;
}

function parseLcovBranch(
  trimmed: string,
  source: string | undefined,
  points: Map<string, CoveragePoint>,
): boolean {
  const match = /^BRDA:(\d+),([^,]+),([^,]+),(.+)$/.exec(trimmed);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return false;
  }
  addCoveragePoint(points, {
    metric: "branches",
    source: requireLcovSource(source, trimmed),
    location: [match[1], match[2], match[3]].join(":"),
    covered: match[4] !== "-" && Number.parseInt(match[4], 10) > 0,
    weight: 1,
  });
  return true;
}

function parseLcovSummary(
  trimmed: string,
  source: string | undefined,
  state: LcovSummaryState,
): boolean {
  const match = /^(LF|LH|FNF|FNH|BRF|BRH):(\d+)$/.exec(trimmed);
  if (match?.[1] === undefined || match[2] === undefined) {
    return false;
  }
  requireLcovSource(source, trimmed);
  const value = Number.parseInt(match[2], 10);
  switch (match[1]) {
    case "LF":
      state.lines.total = value;
      break;
    case "LH":
      state.lines.covered = value;
      break;
    case "FNF":
      state.functions.total = value;
      break;
    case "FNH":
      state.functions.covered = value;
      break;
    case "BRF":
      state.branches.total = value;
      break;
    case "BRH":
      state.branches.covered = value;
      break;
  }
  return true;
}

function anonymousSummaryCoveragePoints(
  metric: "lines" | "functions" | "branches",
  source: string,
  total: number,
  coveredCount: number,
): CoveragePoint[] {
  const points: CoveragePoint[] = [];
  for (let index = 0; index < total; index += 1) {
    const isCovered = index < coveredCount;
    points.push({
      metric,
      source,
      location: `__lcov_summary_${index.toString()}`,
      covered: isCovered,
      weight: 1,
      identity: "anonymous-summary",
    });
  }
  return points;
}

function addLcovSummaryRemainder(
  points: Map<string, CoveragePoint>,
  source: string,
  metric: "lines" | "functions" | "branches",
  totals: LcovMetricTotals,
): void {
  if (totals.total === undefined && totals.covered === undefined) {
    return;
  }
  if (totals.total === undefined || totals.covered === undefined) {
    throw new Error(`LCOV ${metric} summary is incomplete for ${source}`);
  }
  if (totals.covered > totals.total) {
    throw new Error(`LCOV ${metric} summary exceeds its total for ${source}`);
  }
  const identified = [...points.values()].filter(
    (point) => point.source === source && point.metric === metric,
  );
  const identifiedCovered = identified.filter((point) => point.covered).length;
  const unidentifiedTotal = totals.total - identified.length;
  const unidentifiedCovered = totals.covered - identifiedCovered;
  if (
    unidentifiedTotal < 0 ||
    unidentifiedCovered < 0 ||
    unidentifiedCovered > unidentifiedTotal
  ) {
    throw new Error(
      `LCOV ${metric} summary conflicts with identified records for ${source}`,
    );
  }
  for (const point of anonymousSummaryCoveragePoints(
    metric,
    source,
    unidentifiedTotal,
    unidentifiedCovered,
  )) {
    addCoveragePoint(points, point);
  }
}

function finalizeLcovRecord(
  source: string,
  points: Map<string, CoveragePoint>,
  summary: LcovSummaryState,
): void {
  addLcovSummaryRemainder(points, source, "lines", summary.lines);
  addLcovSummaryRemainder(points, source, "functions", summary.functions);
  addLcovSummaryRemainder(points, source, "branches", summary.branches);
}

export function parseLcov(contents: string): CoverageReport {
  const points = new Map<string, CoveragePoint>();
  let recordPoints = new Map<string, CoveragePoint>();
  let source: string | undefined;
  let functionState: LcovFunctionState = {
    definitions: new Map(),
    nextCoverageIndex: new Map(),
  };
  let summaryState = emptyLcovSummaryState();
  const finishRecord = (): void => {
    if (source === undefined) {
      return;
    }
    finalizeLcovRecord(source, recordPoints, summaryState);
    for (const point of recordPoints.values()) {
      addCoveragePoint(points, point);
    }
    source = undefined;
    recordPoints = new Map();
    functionState = {
      definitions: new Map(),
      nextCoverageIndex: new Map(),
    };
    summaryState = emptyLcovSummaryState();
  };
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SF:")) {
      finishRecord();
      source = trimmed.slice(3);
      if (source.length === 0) {
        throw new Error("LCOV report contains an empty source path");
      }
    } else if (trimmed === "end_of_record") {
      finishRecord();
    } else if (
      parseLcovLineDetail(trimmed, source, recordPoints) ||
      parseLcovFunctionDefinition(
        trimmed,
        source,
        recordPoints,
        functionState,
      ) ||
      parseLcovFunctionCoverage(trimmed, source, recordPoints, functionState) ||
      parseLcovBranch(trimmed, source, recordPoints) ||
      parseLcovSummary(trimmed, source, summaryState)
    ) {
      continue;
    }
  }
  finishRecord();
  if (![...points.values()].some((point) => point.metric === "lines")) {
    throw new Error("LCOV report contains no line coverage records");
  }
  return {
    points: [...points.values()],
    unavailableMetrics: ["statements"],
  };
}

export function parseGoCover(contents: string): CoverageReport {
  const lines = contents.trim().split("\n");
  if (lines[0]?.startsWith("mode: ") !== true) {
    throw new Error("Go coverage profile is missing its mode header");
  }
  const points = new Map<string, CoveragePoint>();
  for (const line of lines.slice(1)) {
    if (line.trim().length === 0) {
      continue;
    }
    const match = /^(.+):(\d+\.\d+),(\d+\.\d+) (\d+) (\d+)$/.exec(line);
    if (
      match?.[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined ||
      match[4] === undefined ||
      match[5] === undefined
    ) {
      throw new Error(`Malformed Go coverage profile line: ${line}`);
    }
    addCoveragePoint(points, {
      metric: "statements",
      source: match[1],
      location: `${match[2]}-${match[3]}`,
      covered: Number.parseInt(match[5], 10) > 0,
      weight: Number.parseInt(match[4], 10),
    });
  }
  return {
    points: [...points.values()],
    unavailableMetrics: ["lines", "functions", "branches"],
  };
}

export function summarizeCoverageReports(
  reports: readonly CoverageReport[],
): CoverageMetrics {
  const coverageGroups = new Map<
    string,
    {
      metric: CoverageMetricName;
      reportIndexes: Set<number>;
      hasAnonymousSummary: boolean;
    }
  >();
  for (const [reportIndex, report] of reports.entries()) {
    for (const point of report.points) {
      const key = [point.metric, point.source].join("\u{0}");
      const group = coverageGroups.get(key) ?? {
        metric: point.metric,
        reportIndexes: new Set<number>(),
        hasAnonymousSummary: false,
      };
      group.reportIndexes.add(reportIndex);
      group.hasAnonymousSummary ||= point.identity === "anonymous-summary";
      coverageGroups.set(key, group);
    }
  }
  const unavailableMetrics = new Set(
    reports.flatMap((report) => report.unavailableMetrics ?? []),
  );
  for (const group of coverageGroups.values()) {
    if (group.hasAnonymousSummary && group.reportIndexes.size > 1) {
      unavailableMetrics.add(group.metric);
    }
  }

  const points = new Map<string, CoveragePoint>();
  for (const report of reports) {
    for (const point of report.points) {
      addCoveragePoint(points, point);
    }
  }
  const result: CoverageMetrics = {};
  for (const metric of coverageMetricNames) {
    if (unavailableMetrics.has(metric)) {
      continue;
    }
    const matching = [...points.values()].filter(
      (point) => point.metric === metric,
    );
    if (matching.length > 0) {
      result[metric] = {
        covered: matching.reduce(
          (total, point) => total + (point.covered ? point.weight : 0),
          0,
        ),
        total: matching.reduce((total, point) => total + point.weight, 0),
      };
    }
  }
  if (unavailableMetrics.size > 0) {
    result.unavailableMetrics = coverageMetricNames.filter((metric) =>
      unavailableMetrics.has(metric),
    );
  }
  return result;
}
