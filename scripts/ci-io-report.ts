#!/usr/bin/env bun

import { z } from "zod";

import {
  fetchBuildkiteBuild,
  fetchBuildkiteBuilds,
  type BuildkiteBuild,
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

const POST_FIXTURE_SCRAPE_GRACE_MILLISECONDS = 20_000;

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
      input.options.enforceAbGates &&
        input.options.comparisonProfile === "docker-ab",
    );
  }
  const from = z.string().parse(input.options.from);
  const to = z.string().parse(input.options.to);
  const cohortWindow = requestedCohortWindow(from, to);
  const builds = await fetchBuildkiteBuilds(input.buildkite, cohortWindow);
  return selectCohortBuilds(builds, cohortWindow, input.now);
}

export function postFixtureScrapeWaitMilliseconds(
  builds: BuildkiteBuild[],
  fixtureSteps: string[],
  now: Date,
): number {
  const selectedSteps = new Set(fixtureSteps);
  const finishedAt = builds.flatMap((build) =>
    build.jobs
      .filter((job) => job.step_key !== null && selectedSteps.has(job.step_key))
      .flatMap((job) =>
        job.finished_at === null ? [] : [new Date(job.finished_at).getTime()],
      ),
  );
  if (finishedAt.length === 0) {
    return 0;
  }
  const latestFinish = Math.max(...finishedAt);
  const remaining =
    latestFinish + POST_FIXTURE_SCRAPE_GRACE_MILLISECONDS - now.getTime();
  return Math.max(
    0,
    Math.min(POST_FIXTURE_SCRAPE_GRACE_MILLISECONDS, remaining),
  );
}

async function settledCandidateSelection(input: {
  options: CliOptions;
  buildkite: BuildkiteClientConfig;
  now: Date;
}): Promise<{
  selection: BuildSelection;
  observedAt: Date;
}> {
  let selection = await candidateSelection(input);
  if (
    !input.options.enforceAbGates ||
    input.options.comparisonProfile !== "docker-ab"
  ) {
    return { selection, observedAt: input.now };
  }
  const waitMilliseconds = postFixtureScrapeWaitMilliseconds(
    selection.builds,
    input.options.fixtureSteps,
    input.now,
  );
  if (waitMilliseconds > 0) {
    await Bun.sleep(waitMilliseconds);
  }
  const observedAt = new Date();
  selection = await candidateSelection({
    options: input.options,
    buildkite: input.buildkite,
    now: observedAt,
  });
  return { selection, observedAt };
}

async function explicitBuildSelection(
  buildNumbers: number[],
  buildkite: BuildkiteClientConfig,
  now: Date,
  allowUnfinishedDockerAb: boolean,
): Promise<BuildSelection> {
  const builds = await Promise.all(
    buildNumbers.map((number) => fetchBuildkiteBuild(buildkite, number)),
  );
  return selectExplicitBuilds({ builds, now, allowUnfinishedDockerAb });
}

export function assertEquivalentAbSelections(
  baseline: BuildkiteBuild[],
  candidate: BuildkiteBuild[],
): void {
  const candidateNumbers = new Set(candidate.map((build) => build.number));
  if (baseline.some((build) => candidateNumbers.has(build.number))) {
    throw new Error("CI I/O A/B build selections must be disjoint");
  }
  const baselineCommits = new Set(baseline.map((build) => build.commit));
  const candidateCommits = new Set(candidate.map((build) => build.commit));
  if (
    baselineCommits.size !== 1 ||
    candidateCommits.size !== 1 ||
    baselineCommits.values().next().value !==
      candidateCommits.values().next().value
  ) {
    throw new Error(
      "CI I/O A/B builds must use one identical commit in both selections",
    );
  }
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
  candidateBuilds: BuildkiteBuild[];
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
      false,
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
  if (
    input.options.enforceAbGates &&
    input.options.comparisonProfile === "docker-ab"
  ) {
    assertEquivalentAbSelections(selection.builds, input.candidateBuilds);
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
  const gateStatus =
    report.comparisonProfile === "fixed-corpus"
      ? report.comparison?.fixedCorpusGate.status
      : report.comparison?.gates.status;
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
  const settled = await settledCandidateSelection({
    options,
    buildkite,
    now: startedAt,
  });
  const selected = settled.selection;
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
    candidateBuilds: selected.builds,
    pipeline,
    excludedJobIds,
    now: settled.observedAt,
  });
  const fixtureSteps =
    options.fixtureSteps.length === 0 ? null : new Set(options.fixtureSteps);
  const report: CiIoReport = {
    schemaVersion: 2,
    generatedAt: settled.observedAt.toISOString(),
    metricSource: options.metricSource,
    comparisonProfile: options.comparisonProfile,
    organization,
    pipeline,
    candidate,
    baseline,
    comparison:
      baseline === null
        ? null
        : compareWindows(baseline, candidate, fixtureSteps),
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
  if (options.enforceAbGates) {
    const gateStatus =
      options.comparisonProfile === "fixed-corpus"
        ? report.comparison?.fixedCorpusGate.status
        : report.comparison?.gates.status;
    if (gateStatus !== "passed") {
      throw new Error(
        `CI I/O ${options.comparisonProfile} gates did not pass: ${gateStatus ?? "missing comparison"}`,
      );
    }
  }
}

if (import.meta.main) {
  await main();
}
