import { createInstrumenter } from "istanbul-lib-instrument";
import path from "node:path";
import type {
  CoverageMetricName,
  CoveragePoint,
  CoverageReport,
} from "./coverage-reporting.ts";

const instrumentableSourcePattern = /\.[cm]?[jt]sx?$/;
const uncoveredSourceExtensions = new Set([
  ".astro",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".fish",
  ".glsl",
  ".h",
  ".hh",
  ".hlsl",
  ".hpp",
  ".java",
  ".kt",
  ".kts",
  ".lua",
  ".m",
  ".mm",
  ".py",
  ".rs",
  ".s",
  ".sh",
  ".swift",
]);
const excludedSourceDirectoryPattern =
  /(?:^|\/)(?:__fixtures__|__tests__|build|coverage|dist|fixtures|generated|node_modules|test|tests)(?:\/|$)/;
const excludedInstrumentableSourcePattern =
  /\.(?:d|spec|test|stories)\.[cm]?[jt]sx?$|(?:^|\/)[^/]+\.config\.[cm]?[jt]sx?$/;
const sourceMetricNames = [
  "lines",
  "functions",
  "branches",
] satisfies readonly CoverageMetricName[];
const allMetricNames = [
  "lines",
  "statements",
  "functions",
  "branches",
] satisfies readonly CoverageMetricName[];

function normalizeRepositoryPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function coverableWorkspaceSources(
  sourceDirectories: readonly string[],
  workspaceDirectories: readonly string[],
  trackedFiles: readonly string[],
): string[] {
  return workspaceSourcesMatching(
    sourceDirectories,
    workspaceDirectories,
    trackedFiles,
    (file) =>
      instrumentableSourcePattern.test(file) &&
      !excludedInstrumentableSourcePattern.test(file),
  );
}

export function uncoveredWorkspaceSources(
  sourceDirectories: readonly string[],
  workspaceDirectories: readonly string[],
  trackedFiles: readonly string[],
): string[] {
  return workspaceSourcesMatching(
    sourceDirectories,
    workspaceDirectories,
    trackedFiles,
    (file) => {
      const extension = path.extname(file).toLowerCase();
      const basename = path.basename(file, extension).toLowerCase();
      return (
        uncoveredSourceExtensions.has(extension) &&
        basename !== "test" &&
        basename !== "tests" &&
        !basename.startsWith("test_") &&
        !basename.endsWith("_test") &&
        !basename.endsWith("_spec")
      );
    },
  );
}

function workspaceSourcesMatching(
  sourceDirectories: readonly string[],
  workspaceDirectories: readonly string[],
  trackedFiles: readonly string[],
  matchesSource: (file: string) => boolean,
): string[] {
  const normalizedWorkspaceDirectories = workspaceDirectories.map((directory) =>
    normalizeRepositoryPath(directory),
  );
  const candidates = new Set<string>();
  for (const sourceDirectory of sourceDirectories) {
    const normalizedSourceDirectory = normalizeRepositoryPath(sourceDirectory);
    const sourcePrefix = `${normalizedSourceDirectory}/`;
    const nestedWorkspacePrefixes = normalizedWorkspaceDirectories
      .filter(
        (directory) =>
          directory !== normalizedSourceDirectory &&
          directory.startsWith(sourcePrefix),
      )
      .map((directory) => `${directory}/`);
    for (const trackedFile of trackedFiles) {
      const file = normalizeRepositoryPath(trackedFile);
      if (
        file.startsWith(sourcePrefix) &&
        !nestedWorkspacePrefixes.some((prefix) => file.startsWith(prefix)) &&
        !excludedSourceDirectoryPattern.test(file) &&
        matchesSource(file)
      ) {
        candidates.add(file);
      }
    }
  }
  return [...candidates].sort();
}

export function resolveCoverageSource(
  repositoryRoot: string,
  workspaceDirectory: string,
  source: string,
): string {
  if (path.isAbsolute(source)) {
    return path.normalize(source);
  }
  const normalizedSource = normalizeRepositoryPath(source);
  const normalizedWorkspace = normalizeRepositoryPath(workspaceDirectory);
  if (
    normalizedSource === normalizedWorkspace ||
    normalizedSource.startsWith(`${normalizedWorkspace}/`)
  ) {
    return path.resolve(repositoryRoot, normalizedSource);
  }
  return path.resolve(repositoryRoot, normalizedWorkspace, normalizedSource);
}

export function initialSourceCoverage(
  contents: string,
  source: string,
): CoverageReport {
  const instrumenter = createInstrumenter({
    esModules: true,
    parserPlugins: [
      "decorators-legacy",
      "explicitResourceManagement",
      "importAttributes",
      "jsx",
      "typescript",
    ],
  });
  instrumenter.instrumentSync(contents, source);
  const coverage = instrumenter.lastFileCoverage();
  const points: CoveragePoint[] = [];
  const executableLines = [
    ...Object.values(coverage.statementMap).map(
      (statement) => statement.start.line,
    ),
    ...Object.values(coverage.fnMap).map((mapping) => mapping.decl.start.line),
  ]
    .sort((left, right) => left - right)
    // Bun 1.3 LCOV counts unique executable physical source lines, even when
    // several executable regions share a line. Function declarations are
    // included because a multiline body starts on a later physical line.
    .filter((line, index, lines) => index === 0 || line !== lines[index - 1]);

  for (const line of executableLines) {
    points.push({
      metric: "lines",
      source,
      location: line.toString(),
      covered: false,
      weight: 1,
    });
  }
  for (const mapping of Object.values(coverage.fnMap)) {
    points.push({
      metric: "functions",
      source,
      location: `${mapping.decl.start.line.toString()}:${mapping.name}`,
      covered: false,
      weight: 1,
    });
  }
  for (const [branchId, mapping] of Object.entries(coverage.branchMap)) {
    for (const branchIndex of mapping.locations.keys()) {
      points.push({
        metric: "branches",
        source,
        location: `${branchId}:${branchIndex.toString()}`,
        covered: false,
        weight: 1,
      });
    }
  }
  return { points, unavailableMetrics: ["statements"] };
}

export function sourceCoverageSupplement(
  initialCoverage: CoverageReport,
  reportedMetrics: ReadonlySet<CoverageMetricName> | undefined,
): CoverageReport {
  if (reportedMetrics === undefined) {
    return initialCoverage;
  }
  const sourceMetrics = new Set(
    initialCoverage.points.map((point) => point.metric),
  );
  const unavailableMetrics = new Set(initialCoverage.unavailableMetrics);
  for (const metric of sourceMetricNames) {
    if (sourceMetrics.has(metric) && !reportedMetrics.has(metric)) {
      unavailableMetrics.add(metric);
    }
  }
  return {
    points: [],
    unavailableMetrics: allMetricNames.filter((metric) =>
      unavailableMetrics.has(metric),
    ),
  };
}
