import type {
  CiIoReport,
  FixtureGate,
  IntegrityIssue,
  JobIoReport,
  StepIoReport,
  WindowIoReport,
} from "./ci-io-report-model.ts";

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "missing";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const sign = bytes < 0 ? -1 : 1;
  let value = Math.abs(bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${(value * sign).toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex] ?? "B"}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "missing" : `${value.toFixed(1)}%`;
}

function formatSeconds(value: number | null): string {
  return value === null ? "missing" : `${value.toFixed(1)}s`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}

function stepRows(steps: StepIoReport[]): string[] {
  return steps.map(
    (step) =>
      `| \`${escapeCell(step.stepKey)}\` | ${String(step.jobCount)} | ${String(step.measuredJobCount)} | ${formatBytes(step.totalWriteBytes)} | ${formatBytes(step.medianWriteBytes)} | ${formatBytes(step.p95WriteBytes)} | ${formatSeconds(step.medianDurationSeconds)} | ${formatSeconds(step.p95DurationSeconds)} | ${formatBytes(step.medianNetworkBytes)} | ${formatBytes(step.canceledBuildWriteBytes)} |`,
  );
}

function componentRows(report: WindowIoReport): string[] {
  return Object.entries(report.summary.componentWriteBytes).map(
    ([container, bytes]) =>
      `| \`${escapeCell(container)}\` | ${formatBytes(bytes)} | ${formatPercent((report.summary.componentWriteShares[container] ?? 0) * 100)} |`,
  );
}

function topJobRows(jobs: JobIoReport[]): string[] {
  return [...jobs]
    .sort((left, right) => (right.writeBytes ?? -1) - (left.writeBytes ?? -1))
    .slice(0, 25)
    .map(
      (job) =>
        `| [#${String(job.buildNumber)}](${job.buildUrl}) | [\`${escapeCell(job.stepKey)}\`](${job.jobUrl}) | ${escapeCell(job.jobState)} | ${job.durationSeconds.toFixed(1)}s | ${formatBytes(job.writeBytes)} | ${formatBytes(job.networkReceiveBytes === null || job.networkTransmitBytes === null ? null : job.networkReceiveBytes + job.networkTransmitBytes)} | ${escapeCell(job.coverage)} (${String(job.sampleCount)}) |`,
    );
}

function issueRows(issues: IntegrityIssue[]): string[] {
  return issues.map(
    (currentIssue) =>
      `| \`${currentIssue.code}\` | ${escapeCell(currentIssue.jobId ?? "-")} | ${escapeCell(currentIssue.pod ?? "-")} | ${escapeCell(currentIssue.message)} |`,
  );
}

function renderWindow(label: string, report: WindowIoReport): string[] {
  const summary = report.summary;
  const lines = [
    `## ${label}`,
    "",
    `Window: \`${report.from}\` through \`${report.to}\``,
    "",
    "| Builds | Jobs measured / expected | Complete | Lower bounds | Missing | Parent writes | Canceled-build writes | Canceled-job writes | Pod network RX + TX |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| ${String(summary.buildCount)} | ${String(summary.measuredJobCount)} / ${String(summary.expectedJobCount)} (${formatPercent(summary.sampleCoveragePercent)}) | ${String(summary.completeJobCount)} | ${String(summary.lowerBoundJobCount)} | ${String(summary.missingJobCount)} | ${formatBytes(summary.totalWriteBytes)} | ${formatBytes(summary.canceledBuildWriteBytes)} | ${formatBytes(summary.canceledJobWriteBytes)} | ${formatBytes(summary.totalNetworkReceiveBytes + summary.totalNetworkTransmitBytes)} |`,
    "",
    "### Per-step distribution",
    "",
    "| Step | Jobs | Measured | Total writes | Median writes | p95 writes | Median duration | p95 duration | Median network | Canceled-build writes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...stepRows(report.steps),
    "",
    "### Child-container attribution",
    "",
    "Child counters are diagnostic only and are never added to pod-parent totals.",
    "",
    "| Container | Writes | Share of attributed child writes |",
    "| --- | --- | --- |",
    ...componentRows(report),
    "",
    "### Top jobs",
    "",
    "| Build | Step | State | Duration | Parent writes | Network | Coverage (samples) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...topJobRows(report.jobs),
  ];
  if (report.integrityIssues.length > 0) {
    lines.push(
      "",
      "### Metric integrity issues",
      "",
      "| Code | Job | Pod | Detail |",
      "| --- | --- | --- | --- |",
      ...issueRows(report.integrityIssues),
    );
  }
  return lines;
}

function fixtureRows(fixtures: FixtureGate[]): string[] {
  return fixtures.map(
    (fixture) =>
      `| \`${escapeCell(fixture.stepKey)}\` | ${fixture.status} | ${formatPercent(fixture.writeReductionPercent)} | ${formatPercent(fixture.durationChangePercent)} | ${formatPercent(fixture.networkChangePercent)} | ${escapeCell(fixture.reasons.join("; ") || "-")} |`,
  );
}

function comparisonLines(report: CiIoReport): string[] {
  const comparison = report.comparison;
  if (comparison === null) {
    return [];
  }
  return [
    "## Baseline versus candidate",
    "",
    `Aggregate writes: ${formatPercent(comparison.writeBytesChangePercent)} (${formatBytes(comparison.writeBytesChange)}). Normalized per measured job: ${formatPercent(comparison.writeBytesPerJobChangePercent)}.`,
    "",
    `A/B gates: **${comparison.gates.status}**. Geometric-mean write reduction: ${formatPercent(comparison.gates.geometricMeanWriteReductionPercent)}.`,
    "",
    "| Fixture step | Gate | Write reduction | Duration change | Network change | Reasons |",
    "| --- | --- | --- | --- | --- | --- |",
    ...fixtureRows(comparison.gates.fixtures),
    "",
    ...comparison.gates.reasons.map((reason) => `- ${reason}`),
  ];
}

export function renderCiIoMarkdown(report: CiIoReport): string {
  const lines = [
    "# CI I/O report",
    "",
    `Generated ${report.generatedAt} for \`${escapeCell(report.organization)}/${escapeCell(report.pipeline)}\` using the explicit \`${report.metricSource}\` metric source.`,
    "",
    ...comparisonLines(report),
  ];
  if (report.comparison !== null) {
    lines.push("");
  }
  if (report.baseline !== null) {
    lines.push(...renderWindow("Baseline", report.baseline), "");
  }
  lines.push(...renderWindow("Candidate", report.candidate));
  return `${lines.join("\n")}\n`;
}
