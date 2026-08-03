import path from "node:path";
import {
  sanitizeWorkspace,
  testStepReportName,
  TestManifestSchema,
} from "./ci-reporting.ts";
import { sumCoverageMetrics } from "./coverage-metrics.ts";
import {
  coveragePercentage,
  parseGoCover,
  parseLcov,
  summarizeCoverageReports,
  type CoverageMetric,
  type CoverageMetricName,
  type CoverageMetrics,
  type CoverageReport,
} from "./coverage-reporting.ts";
import {
  coverableWorkspaceSources,
  initialSourceCoverage,
  resolveCoverageSource,
  sourceCoverageSupplement,
  uncoveredWorkspaceSources,
} from "./coverage-source-inventory.ts";

const repositoryRoot = path.resolve(import.meta.dir, "..");
const rawDirectory = path.join(
  repositoryRoot,
  ".ci-reports",
  "coverage",
  "raw",
);
const outputDirectory = path.join(repositoryRoot, ".ci-reports", "coverage");
const reportingArguments = process.argv.slice(2);
const unknownArguments = reportingArguments
  .filter((argument) => argument !== "--require-complete")
  .filter((argument) => argument !== "--allow-partial");
if (unknownArguments.length > 0) {
  throw new Error(`Unknown arguments: ${unknownArguments.join(", ")}`);
}
const requireComplete = reportingArguments.includes("--require-complete");
const allowPartial = reportingArguments.includes("--allow-partial");
if (requireComplete === allowPartial) {
  throw new Error("Pass exactly one of --require-complete or --allow-partial");
}

const manifest = TestManifestSchema.parse(
  await Bun.file(path.join(import.meta.dir, "ci-test-manifest.json")).json(),
);
const workspacesByDirectory = new Map(
  manifest.workspaces.map((workspace) => [
    sanitizeWorkspace(workspace.package),
    workspace.package,
  ]),
);
const reportsByWorkspace = new Map<string, CoverageReport[]>();
await Bun.$`mkdir -p ${rawDirectory}`;

async function collect(
  pattern: string,
  parse: (contents: string) => CoverageReport,
): Promise<void> {
  const glob = new Bun.Glob(pattern);
  for await (const relativePath of glob.scan({
    cwd: rawDirectory,
    onlyFiles: true,
  })) {
    const workspaceDirectory = relativePath.split(path.sep)[0];
    if (workspaceDirectory === undefined) {
      throw new Error(
        `Coverage report has no workspace directory: ${relativePath}`,
      );
    }
    const workspace = workspacesByDirectory.get(workspaceDirectory);
    if (workspace === undefined) {
      throw new Error(
        `Coverage report belongs to unknown workspace directory ${workspaceDirectory}`,
      );
    }
    const reports = reportsByWorkspace.get(workspace) ?? [];
    reports.push(
      parse(await Bun.file(path.join(rawDirectory, relativePath)).text()),
    );
    reportsByWorkspace.set(workspace, reports);
  }
}

await collect("**/lcov.info", parseLcov);
await collect("**/coverage.out", parseGoCover);

if (requireComplete) {
  const missing: string[] = [];
  for (const workspace of manifest.workspaces) {
    for (const [index, step] of workspace.steps.entries()) {
      if (step.runner === "cargo" || step.runner === "command") {
        continue;
      }
      const extension = step.runner === "go" ? "coverage.out" : "lcov.info";
      const expectedPath = path.join(
        rawDirectory,
        sanitizeWorkspace(workspace.package),
        testStepReportName(step, index),
        extension,
      );
      if (!(await Bun.file(expectedPath).exists())) {
        missing.push(path.relative(repositoryRoot, expectedPath));
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Scheduled reporting is missing ${missing.length.toString()} coverage reports:\n${missing.join("\n")}`,
    );
  }
}

const trackedFilesProcess = Bun.spawn(["git", "ls-files", "-z"], {
  cwd: repositoryRoot,
  stdout: "pipe",
  stderr: "inherit",
});
const [trackedFilesExitCode, trackedFilesOutput] = await Promise.all([
  trackedFilesProcess.exited,
  new Response(trackedFilesProcess.stdout).text(),
]);
if (trackedFilesExitCode !== 0) {
  throw new Error(
    `git ls-files exited with status ${trackedFilesExitCode.toString()}`,
  );
}
const trackedFiles = trackedFilesOutput
  .split("\u{0}")
  .filter((file) => file.length > 0);
const coverageWorkspaces = [
  ...manifest.workspaces.map((workspace) => ({
    package: workspace.package,
    directory: workspace.directory,
    sourceDirectories: workspace.coverageSourceDirectories ?? [
      workspace.directory,
    ],
  })),
  ...manifest.testlessWorkspaces.map((workspace) => ({
    package: workspace.package,
    directory: workspace.directory,
    sourceDirectories: [workspace.directory],
  })),
  ...manifest.separateTests.map((workspace) => ({
    package: workspace.package,
    directory: workspace.directory,
    sourceDirectories: [workspace.directory],
  })),
];
const workspaceDirectories = coverageWorkspaces.map(
  (workspace) => workspace.directory,
);
const summarizedWorkspaces = allowPartial
  ? coverageWorkspaces.filter((workspace) =>
      reportsByWorkspace.has(workspace.package),
    )
  : coverageWorkspaces;
for (const workspace of summarizedWorkspaces) {
  const coverableSources = coverableWorkspaceSources(
    workspace.sourceDirectories,
    workspaceDirectories,
    trackedFiles,
  );
  const uncoveredSources = uncoveredWorkspaceSources(
    workspace.sourceDirectories,
    workspaceDirectories,
    trackedFiles,
  );
  const coverableAbsoluteSources = new Set(
    coverableSources.map((source) => path.resolve(repositoryRoot, source)),
  );
  const workspaceReports: CoverageReport[] = (
    reportsByWorkspace.get(workspace.package) ?? []
  ).map((report) => {
    const points = report.points.filter((point) => {
      const absoluteSource = resolveCoverageSource(
        repositoryRoot,
        workspace.directory,
        point.source,
      );
      return (
        point.metric === "statements" ||
        coverableAbsoluteSources.has(absoluteSource)
      );
    });
    return report.unavailableMetrics === undefined
      ? { points }
      : { points, unavailableMetrics: report.unavailableMetrics };
  });
  const reportedMetricsBySource = new Map<string, Set<CoverageMetricName>>();
  for (const report of workspaceReports) {
    for (const point of report.points) {
      const absoluteSource = resolveCoverageSource(
        repositoryRoot,
        workspace.directory,
        point.source,
      );
      const reportedMetrics =
        reportedMetricsBySource.get(absoluteSource) ??
        new Set<CoverageMetricName>();
      reportedMetrics.add(point.metric);
      reportedMetricsBySource.set(absoluteSource, reportedMetrics);
    }
  }
  for (const source of coverableSources) {
    const absoluteSource = path.resolve(repositoryRoot, source);
    workspaceReports.push(
      sourceCoverageSupplement(
        initialSourceCoverage(
          await Bun.file(absoluteSource).text(),
          absoluteSource,
        ),
        reportedMetricsBySource.get(absoluteSource),
      ),
    );
  }
  if (uncoveredSources.length > 0) {
    workspaceReports.push({
      points: [],
      unavailableMetrics: ["lines", "statements", "functions", "branches"],
    });
  }
  reportsByWorkspace.set(workspace.package, workspaceReports);
}

const workspaceSummaries = [...reportsByWorkspace.entries()]
  .map(([workspace, reports]) => {
    const coverage = summarizeCoverageReports(reports);
    return { workspace, coverage };
  })
  .sort((left, right) => left.workspace.localeCompare(right.workspace));
const totals = sumCoverageMetrics(
  workspaceSummaries.map(({ coverage }) => coverage),
);

function formatMetric(
  summary: CoverageMetrics,
  metricName: CoverageMetricName,
): string {
  if (summary.unavailableMetrics?.includes(metricName) === true) {
    return "Unavailable¹";
  }
  const metric: CoverageMetric | undefined = summary[metricName];
  return metric === undefined
    ? "—"
    : `${coveragePercentage(metric).toFixed(2)}% (${metric.covered.toString()}/${metric.total.toString()})`;
}

const markdown = [
  "# Coverage summary",
  "",
  "| Workspace | Lines | Statements | Functions | Branches |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...workspaceSummaries.map(
    ({ workspace, coverage }) =>
      `| ${workspace} | ${formatMetric(coverage, "lines")} | ${formatMetric(coverage, "statements")} | ${formatMetric(coverage, "functions")} | ${formatMetric(coverage, "branches")} |`,
  ),
  `| **Total** | **${formatMetric(totals, "lines")}** | **${formatMetric(totals, "statements")}** | **${formatMetric(totals, "functions")}** | **${formatMetric(totals, "branches")}** |`,
  "",
  "¹ A metric is unavailable when its producer does not report it, an exact union cannot be derived, or production source uses a language without coverage collection.",
  "",
].join("\n");

await Bun.$`mkdir -p ${outputDirectory}`;
await Promise.all([
  Bun.write(
    path.join(outputDirectory, "summary.json"),
    `${JSON.stringify({ version: 2, totals, workspaces: workspaceSummaries }, null, 2)}\n`,
  ),
  Bun.write(path.join(outputDirectory, "summary.md"), markdown),
]);

console.log(
  `Wrote coverage summary for ${workspaceSummaries.length.toString()} workspaces`,
);
