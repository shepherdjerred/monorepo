#!/usr/bin/env bun

import { z } from "zod";

import {
  fetchBuildkiteBuild,
  fetchBuildkiteBuilds,
  type BuildkiteClientConfig,
  type PrometheusClientConfig,
  type TimeWindow,
} from "./lib/ci-io-api.ts";
import {
  CI_IO_USAGE,
  parseCliOptions,
  type CliOptions,
} from "./lib/ci-io-cli.ts";
import { renderCiIoMarkdown } from "./lib/ci-io-markdown.ts";
import {
  fetchPrometheusIoMetrics,
  filterPrometheusIoMetrics,
} from "./lib/ci-io-prometheus.ts";
import {
  assertBenchmarkIntegrity,
  buildWindowIoReport,
} from "./lib/ci-io-report.ts";
import type { CiIoReport, WindowIoReport } from "./lib/ci-io-report-model.ts";
import {
  selectCohortBuilds,
  selectExplicitBuilds,
  type BuildSelection,
} from "./lib/ci-io-selection.ts";
import { compareWindows } from "./lib/ci-io-statistics.ts";

function requestedCohortWindow(from: string, to: string): TimeWindow {
  const window = { from: new Date(from), to: new Date(to) };
  if (window.to.getTime() <= window.from.getTime()) {
    throw new Error("cohort created_at end must be after its start");
  }
  return window;
}

async function candidateSelection(input: {
  options: CliOptions;
  buildkite: BuildkiteClientConfig;
  now: Date;
}): Promise<BuildSelection> {
  if (input.options.buildNumbers.length > 0) {
    return explicitBuildSelection(
      input.options.buildNumbers,
      input.buildkite,
      input.now,
    );
  }
  const from = z.string().parse(input.options.from);
  const to = z.string().parse(input.options.to);
  const cohortWindow = requestedCohortWindow(from, to);
  const builds = await fetchBuildkiteBuilds(input.buildkite, cohortWindow);
  return selectCohortBuilds(builds, cohortWindow, input.now);
}

async function explicitBuildSelection(
  buildNumbers: number[],
  buildkite: BuildkiteClientConfig,
  now: Date,
): Promise<BuildSelection> {
  const builds = await Promise.all(
    buildNumbers.map((number) => fetchBuildkiteBuild(buildkite, number)),
  );
  return selectExplicitBuilds({ builds, now });
}

async function collectWindow(input: {
  selection: BuildSelection;
  prometheus: PrometheusClientConfig;
  options: CliOptions;
  pipeline: string;
  excludedJobIds: Set<string>;
}): Promise<WindowIoReport> {
  const metrics = await fetchPrometheusIoMetrics({
    client: input.prometheus,
    window: input.selection.window,
    source: input.options.metricSource,
  });
  const selectedJobIds = new Set(
    input.selection.builds.flatMap((build) =>
      build.jobs.filter((job) => job.started_at !== null).map((job) => job.id),
    ),
  );
  return buildWindowIoReport({
    builds: input.selection.builds,
    window: input.selection.window,
    metrics: filterPrometheusIoMetrics(metrics, selectedJobIds),
    pipeline: input.pipeline,
    excludedJobIds: input.excludedJobIds,
    cohort: input.selection.cohort,
    unfinishedBuilds: input.selection.unfinishedBuilds,
  });
}

async function collectBaseline(input: {
  options: CliOptions;
  buildkite: BuildkiteClientConfig;
  prometheus: PrometheusClientConfig;
  pipeline: string;
  excludedJobIds: Set<string>;
  now: Date;
}): Promise<WindowIoReport | null> {
  let selection: BuildSelection | null = null;
  if (input.options.baselineBuildNumbers.length > 0) {
    selection = await explicitBuildSelection(
      input.options.baselineBuildNumbers,
      input.buildkite,
      input.now,
    );
  } else if (
    input.options.baselineFrom !== undefined &&
    input.options.baselineTo !== undefined
  ) {
    const cohortWindow = requestedCohortWindow(
      input.options.baselineFrom,
      input.options.baselineTo,
    );
    const builds = await fetchBuildkiteBuilds(input.buildkite, cohortWindow);
    selection = selectCohortBuilds(builds, cohortWindow, input.now);
  }
  if (selection === null) {
    return null;
  }
  return collectWindow({
    selection,
    prometheus: input.prometheus,
    options: input.options,
    pipeline: input.pipeline,
    excludedJobIds: input.excludedJobIds,
  });
}

function requiredString(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function fetcher(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

function prometheusConfig(url: string): PrometheusClientConfig {
  const base = { apiBaseUrl: url, fetcher };
  const token = Bun.env["PROMETHEUS_BEARER_TOKEN"];
  return token === undefined ? base : { ...base, bearerToken: token };
}

function annotationStyle(report: CiIoReport): string {
  if (
    report.candidate.integrityIssues.length > 0 ||
    (report.baseline?.integrityIssues.length ?? 0) > 0
  ) {
    return "error";
  }
  const gateStatus = report.comparison?.fixedCorpusGate.status;
  if (gateStatus === "failed") {
    return "error";
  }
  if (
    report.candidate.summary.lowerBoundJobCount > 0 ||
    gateStatus === "inconclusive"
  ) {
    return "warning";
  }
  return "success";
}

async function postAnnotation(
  markdown: string,
  report: CiIoReport,
): Promise<void> {
  const process = Bun.spawn(
    [
      "buildkite-agent",
      "annotate",
      "--style",
      annotationStyle(report),
      "--context",
      "ci-io",
    ],
    {
      stdin: new TextEncoder().encode(markdown),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`buildkite-agent annotate exited ${String(exitCode)}`);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(Bun.argv.slice(2));
  if (options.help) {
    console.log(CI_IO_USAGE);
    return;
  }
  const organization = requiredString(
    options.organization ?? Bun.env["BUILDKITE_ORGANIZATION_SLUG"],
    "Buildkite organization",
  );
  const pipeline = requiredString(
    options.pipeline ?? Bun.env["BUILDKITE_PIPELINE_SLUG"],
    "Buildkite pipeline",
  );
  const buildkiteToken = requiredString(
    Bun.env["BUILDKITE_API_TOKEN"],
    "BUILDKITE_API_TOKEN",
  );
  const prometheusUrl = requiredString(
    options.prometheusUrl ?? Bun.env["PROMETHEUS_URL"],
    "Prometheus URL",
  );
  const buildkite: BuildkiteClientConfig = {
    apiBaseUrl: options.buildkiteApiUrl,
    organization,
    pipeline,
    token: buildkiteToken,
    fetcher,
  };
  const prometheus = prometheusConfig(prometheusUrl);
  const excludedJobIds = new Set<string>();
  if (Bun.env["BUILDKITE_JOB_ID"] !== undefined) {
    excludedJobIds.add(Bun.env["BUILDKITE_JOB_ID"]);
  }
  const startedAt = new Date();
  const selected = await candidateSelection({
    options,
    buildkite,
    now: startedAt,
  });
  const candidate = await collectWindow({
    selection: selected,
    prometheus,
    options,
    pipeline,
    excludedJobIds,
  });
  const baseline = await collectBaseline({
    options,
    buildkite,
    prometheus,
    pipeline,
    excludedJobIds,
    now: startedAt,
  });
  const report: CiIoReport = {
    schemaVersion: 3,
    generatedAt: startedAt.toISOString(),
    metricSource: options.metricSource,
    organization,
    pipeline,
    candidate,
    baseline,
    comparison: baseline === null ? null : compareWindows(baseline, candidate),
  };
  const markdown = renderCiIoMarkdown(report);
  await Promise.all([
    Bun.write(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`),
    Bun.write(options.markdownPath, markdown),
  ]);
  if (options.annotate) {
    await postAnnotation(markdown, report);
  }
  console.log(
    `Wrote ${options.jsonPath} and ${options.markdownPath}: ${String(candidate.summary.totalWriteBytes)} parent-write bytes across ${String(candidate.summary.measuredJobCount)} jobs`,
  );
  if (options.benchmark) {
    assertBenchmarkIntegrity(candidate);
    if (baseline !== null) {
      assertBenchmarkIntegrity(baseline);
    }
  }
  if (options.enforceImpactGates) {
    const gateStatus = report.comparison?.fixedCorpusGate.status;
    if (gateStatus !== "passed") {
      throw new Error(
        `CI I/O fixed-corpus impact gate did not pass: ${gateStatus ?? "missing comparison"}`,
      );
    }
  }
}

if (import.meta.main) {
  await main();
}
