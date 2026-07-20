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
import { renderCiIoMarkdown } from "./lib/ci-io-markdown.ts";
import {
  fetchPrometheusIoMetrics,
  MetricSourceSchema,
} from "./lib/ci-io-prometheus.ts";
import {
  assertBenchmarkIntegrity,
  buildWindowIoReport,
} from "./lib/ci-io-report.ts";
import type { CiIoReport, WindowIoReport } from "./lib/ci-io-report-model.ts";
import { compareWindows } from "./lib/ci-io-statistics.ts";

const CliOptionsSchema = z
  .object({
    buildNumbers: z.array(z.number().int().positive()),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    baselineFrom: z.iso.datetime({ offset: true }).optional(),
    baselineTo: z.iso.datetime({ offset: true }).optional(),
    organization: z.string().min(1).optional(),
    pipeline: z.string().min(1).optional(),
    prometheusUrl: z.url().optional(),
    buildkiteApiUrl: z.url(),
    metricSource: MetricSourceSchema,
    jsonPath: z.string().min(1),
    markdownPath: z.string().min(1),
    fixtureSteps: z.array(z.string().min(1)),
    benchmark: z.boolean(),
    enforceAbGates: z.boolean(),
    annotate: z.boolean(),
    help: z.boolean(),
  })
  .superRefine((options, context) => {
    const hasBuilds = options.buildNumbers.length > 0;
    const hasWindow = options.from !== undefined || options.to !== undefined;
    if (hasBuilds === hasWindow && !options.help) {
      context.addIssue({
        code: "custom",
        message: "provide either --build or both --from and --to",
      });
    }
    if (hasWindow && (options.from === undefined || options.to === undefined)) {
      context.addIssue({
        code: "custom",
        message: "--from and --to must be provided together",
      });
    }
    const hasBaseline =
      options.baselineFrom !== undefined || options.baselineTo !== undefined;
    if (
      hasBaseline &&
      (options.baselineFrom === undefined || options.baselineTo === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "--baseline-from and --baseline-to must be provided together",
      });
    }
    if (options.enforceAbGates && !hasBaseline) {
      context.addIssue({
        code: "custom",
        message: "--enforce-ab-gates requires a baseline window",
      });
    }
    if (options.enforceAbGates && options.fixtureSteps.length === 0) {
      context.addIssue({
        code: "custom",
        message: "--enforce-ab-gates requires at least one --fixture-step",
      });
    }
    if (new Set(options.buildNumbers).size !== options.buildNumbers.length) {
      context.addIssue({
        code: "custom",
        message: "--build numbers must be unique",
      });
    }
    if (new Set(options.fixtureSteps).size !== options.fixtureSteps.length) {
      context.addIssue({
        code: "custom",
        message: "--fixture-step values must be unique",
      });
    }
  });

type CliOptions = z.infer<typeof CliOptionsSchema>;

const USAGE = `Usage:
  bun scripts/ci-io-report.ts --build <number>[,<number>...] [options]
  bun scripts/ci-io-report.ts --from <ISO> --to <ISO> [options]

Options:
  --baseline-from <ISO> --baseline-to <ISO>  Add a comparison window
  --fixture-step <key>                       Select an A/B fixture (repeatable)
  --metrics-source raw|recording             Explicit metric contract (default: raw)
  --organization <slug>                      Defaults to BUILDKITE_ORGANIZATION_SLUG
  --pipeline <slug>                          Defaults to BUILDKITE_PIPELINE_SLUG
  --prometheus-url <url>                     Defaults to PROMETHEUS_URL
  --json <path>                              Default: ci-io.json
  --markdown <path>                          Default: ci-io.md
  --benchmark                                Fail on metric-integrity issues
  --enforce-ab-gates                         Enforce 20%/30%/10% A/B thresholds
  --annotate                                 Post the Markdown as a Buildkite annotation
`;

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseBuildNumbers(value: string): number[] {
  return value
    .split(",")
    .map((part) => z.coerce.number().int().positive().parse(part));
}

type RawCliOptions = {
  buildNumbers: number[];
  fixtureSteps: string[];
  from: string | undefined;
  to: string | undefined;
  baselineFrom: string | undefined;
  baselineTo: string | undefined;
  organization: string | undefined;
  pipeline: string | undefined;
  prometheusUrl: string | undefined;
  buildkiteApiUrl: string;
  metricSource: string;
  jsonPath: string;
  markdownPath: string;
  benchmark: boolean;
  enforceAbGates: boolean;
  annotate: boolean;
  help: boolean;
};

function initialCliOptions(): RawCliOptions {
  return {
    buildNumbers: [],
    fixtureSteps: [],
    from: undefined,
    to: undefined,
    baselineFrom: undefined,
    baselineTo: undefined,
    organization: undefined,
    pipeline: undefined,
    prometheusUrl: undefined,
    buildkiteApiUrl: "https://api.buildkite.com/v2/",
    metricSource: "raw",
    jsonPath: "ci-io.json",
    markdownPath: "ci-io.md",
    benchmark: Bun.env["CI_IO_OBSERVE"] === "true",
    enforceAbGates: false,
    annotate: false,
    help: false,
  };
}

function applyValueFlag(
  options: RawCliOptions,
  flag: string | undefined,
  value: string,
): RawCliOptions {
  switch (flag) {
    case "--build":
      return {
        ...options,
        buildNumbers: [...options.buildNumbers, ...parseBuildNumbers(value)],
      };
    case "--fixture-step":
      return {
        ...options,
        fixtureSteps: [...options.fixtureSteps, value],
      };
    case "--from":
      return { ...options, from: value };
    case "--to":
      return { ...options, to: value };
    case "--baseline-from":
      return { ...options, baselineFrom: value };
    case "--baseline-to":
      return { ...options, baselineTo: value };
    case "--organization":
      return { ...options, organization: value };
    case "--pipeline":
      return { ...options, pipeline: value };
    case "--prometheus-url":
      return { ...options, prometheusUrl: value };
    case "--buildkite-api-url":
      return { ...options, buildkiteApiUrl: value };
    case "--metrics-source":
      return { ...options, metricSource: value };
    case "--json":
      return { ...options, jsonPath: value };
    case "--markdown":
      return { ...options, markdownPath: value };
    case undefined:
      throw new Error("option name is missing");
    default:
      throw new Error(`unknown option: ${flag}`);
  }
}

export function parseCliOptions(args: string[]): CliOptions {
  let options = initialCliOptions();

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--benchmark":
        options = { ...options, benchmark: true };
        break;
      case "--enforce-ab-gates":
        options = { ...options, benchmark: true, enforceAbGates: true };
        break;
      case "--annotate":
        options = { ...options, annotate: true };
        break;
      case "--help":
      case "-h":
        options = { ...options, help: true };
        break;
      case undefined:
        throw new Error("option name is missing");
      default: {
        const value = requiredValue(args, index, flag);
        index += 1;
        options = applyValueFlag(options, flag, value);
      }
    }
  }

  return CliOptionsSchema.parse(options);
}

function explicitBuildWindow(builds: BuildkiteBuild[], now: Date): TimeWindow {
  if (builds.length === 0) {
    throw new Error("at least one explicit build is required");
  }
  const starts = builds.map((build) => new Date(build.created_at).getTime());
  const ends = builds.flatMap((build) => [
    build.finished_at === null
      ? now.getTime()
      : new Date(build.finished_at).getTime(),
    ...build.jobs
      .filter((job) => job.finished_at !== null)
      .map((job) => new Date(job.finished_at ?? "").getTime()),
  ]);
  const earliest = Math.min(...starts) - 30_000;
  const latestWithScrape = Math.max(...ends) + 30_000;
  return {
    from: new Date(earliest),
    to: new Date(Math.min(latestWithScrape, now.getTime())),
  };
}

function validatedWindow(from: string, to: string): TimeWindow {
  const window = { from: new Date(from), to: new Date(to) };
  if (window.to.getTime() <= window.from.getTime()) {
    throw new Error("report window end must be after its start");
  }
  return window;
}

async function candidateSelection(input: {
  options: CliOptions;
  buildkite: BuildkiteClientConfig;
  now: Date;
}): Promise<{ builds: BuildkiteBuild[]; window: TimeWindow }> {
  if (input.options.buildNumbers.length > 0) {
    const builds = await Promise.all(
      input.options.buildNumbers.map((number) =>
        fetchBuildkiteBuild(input.buildkite, number),
      ),
    );
    return { builds, window: explicitBuildWindow(builds, input.now) };
  }
  const from = z.string().parse(input.options.from);
  const to = z.string().parse(input.options.to);
  const window = validatedWindow(from, to);
  return {
    builds: await fetchBuildkiteBuilds(input.buildkite, window),
    window,
  };
}

async function collectWindow(input: {
  builds: BuildkiteBuild[];
  window: TimeWindow;
  prometheus: PrometheusClientConfig;
  options: CliOptions;
  pipeline: string;
  excludedJobIds: Set<string>;
}): Promise<WindowIoReport> {
  const metrics = await fetchPrometheusIoMetrics({
    client: input.prometheus,
    window: input.window,
    source: input.options.metricSource,
  });
  return buildWindowIoReport({
    builds: input.builds,
    window: input.window,
    metrics,
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
  if (report.comparison?.gates.status === "failed") {
    return "error";
  }
  if (
    report.candidate.summary.lowerBoundJobCount > 0 ||
    report.comparison?.gates.status === "inconclusive"
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
    console.log(USAGE);
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
  const now = new Date();
  const selected = await candidateSelection({ options, buildkite, now });
  const candidate = await collectWindow({
    builds: selected.builds,
    window: selected.window,
    prometheus,
    options,
    pipeline,
    excludedJobIds,
  });
  let baseline: WindowIoReport | null = null;
  if (options.baselineFrom !== undefined && options.baselineTo !== undefined) {
    const window = validatedWindow(options.baselineFrom, options.baselineTo);
    baseline = await collectWindow({
      builds: await fetchBuildkiteBuilds(buildkite, window),
      window,
      prometheus,
      options,
      pipeline,
      excludedJobIds,
    });
  }
  const fixtureSteps =
    options.fixtureSteps.length === 0 ? null : new Set(options.fixtureSteps);
  const report: CiIoReport = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    metricSource: options.metricSource,
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
  if (options.enforceAbGates && report.comparison?.gates.status !== "passed") {
    throw new Error(
      `CI I/O A/B gates did not pass: ${report.comparison?.gates.status ?? "missing comparison"}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
