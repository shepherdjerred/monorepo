import { z } from "zod";

import { MetricSourceSchema } from "./ci-io-prometheus.ts";
import { ComparisonProfileSchema } from "./ci-io-report-model.ts";

type CliValidationOptions = {
  buildNumbers: number[];
  baselineBuildNumbers: number[];
  fixtureSteps: string[];
  from?: string | undefined;
  to?: string | undefined;
  baselineFrom?: string | undefined;
  baselineTo?: string | undefined;
  comparisonProfile: "docker-ab" | "fixed-corpus";
  enforceAbGates: boolean;
  help: boolean;
};

function candidateSelectionIssues(options: CliValidationOptions): string[] {
  const issues: string[] = [];
  const hasBuilds = options.buildNumbers.length > 0;
  const hasWindow = options.from !== undefined || options.to !== undefined;
  if (hasBuilds === hasWindow && !options.help) {
    issues.push("provide either --build or both --from and --to");
  }
  if (hasWindow && (options.from === undefined || options.to === undefined)) {
    issues.push("--from and --to must be provided together");
  }
  return issues;
}

function baselineSelectionIssues(options: CliValidationOptions): string[] {
  const issues: string[] = [];
  const hasWindow =
    options.baselineFrom !== undefined || options.baselineTo !== undefined;
  const hasBuilds = options.baselineBuildNumbers.length > 0;
  if (
    hasWindow &&
    (options.baselineFrom === undefined || options.baselineTo === undefined)
  ) {
    issues.push("--baseline-from and --baseline-to must be provided together");
  }
  if (hasWindow && hasBuilds) {
    issues.push(
      "provide either --baseline-build or a baseline time window, not both",
    );
  }
  if (options.enforceAbGates && !hasWindow && !hasBuilds) {
    issues.push("--enforce-ab-gates requires a baseline selection");
  }
  if (
    options.comparisonProfile === "fixed-corpus" &&
    !hasWindow &&
    !hasBuilds
  ) {
    issues.push(
      "--comparison-profile fixed-corpus requires a baseline selection",
    );
  }
  return issues;
}

function comparisonIssues(options: CliValidationOptions): string[] {
  if (
    options.enforceAbGates &&
    options.comparisonProfile === "docker-ab" &&
    options.fixtureSteps.length === 0
  ) {
    return ["--enforce-ab-gates requires at least one --fixture-step"];
  }
  return [];
}

function uniquenessIssues(options: CliValidationOptions): string[] {
  const issues: string[] = [];
  for (const [values, message] of [
    [options.buildNumbers.map(String), "--build numbers must be unique"],
    [
      options.baselineBuildNumbers.map(String),
      "--baseline-build numbers must be unique",
    ],
    [options.fixtureSteps, "--fixture-step values must be unique"],
  ] as const) {
    if (new Set(values).size !== values.length) {
      issues.push(message);
    }
  }
  return issues;
}

const CliOptionsSchema = z
  .object({
    buildNumbers: z.array(z.number().int().positive()),
    baselineBuildNumbers: z.array(z.number().int().positive()),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    baselineFrom: z.iso.datetime({ offset: true }).optional(),
    baselineTo: z.iso.datetime({ offset: true }).optional(),
    organization: z.string().min(1).optional(),
    pipeline: z.string().min(1).optional(),
    prometheusUrl: z.url().optional(),
    buildkiteApiUrl: z.url(),
    metricSource: MetricSourceSchema,
    comparisonProfile: ComparisonProfileSchema,
    jsonPath: z.string().min(1),
    markdownPath: z.string().min(1),
    fixtureSteps: z.array(z.string().min(1)),
    benchmark: z.boolean(),
    enforceAbGates: z.boolean(),
    annotate: z.boolean(),
    help: z.boolean(),
  })
  .superRefine((options, context) => {
    const issues = [
      ...candidateSelectionIssues(options),
      ...baselineSelectionIssues(options),
      ...comparisonIssues(options),
      ...uniquenessIssues(options),
    ];
    for (const message of issues) {
      context.addIssue({ code: "custom", message });
    }
  });

export type CliOptions = z.infer<typeof CliOptionsSchema>;

export const CI_IO_USAGE = `Usage:
  bun scripts/ci-io-report.ts --build <number>[,<number>...] [options]
  bun scripts/ci-io-report.ts --from <ISO> --to <ISO> [options]

Options:
  --baseline-build <number>[,<number>...]     Compare exact prior builds
  --baseline-from <ISO> --baseline-to <ISO>  Add a comparison window
  --fixture-step <key>                       Select an A/B fixture (repeatable)
  --comparison-profile docker-ab|fixed-corpus
                                             Select comparison gates (default: docker-ab)
  --metrics-source raw|recording             Explicit metric contract (default: raw)
  --organization <slug>                      Defaults to BUILDKITE_ORGANIZATION_SLUG
  --pipeline <slug>                          Defaults to BUILDKITE_PIPELINE_SLUG
  --prometheus-url <url>                     Defaults to PROMETHEUS_URL
  --json <path>                              Default: ci-io.json
  --markdown <path>                          Default: ci-io.md
  --benchmark                                Fail on metric-integrity issues
  --enforce-ab-gates                         Enforce the selected comparison profile
  --annotate                                 Post the Markdown as a Buildkite annotation
`;

type RawCliOptions = {
  buildNumbers: number[];
  baselineBuildNumbers: number[];
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
  comparisonProfile: string;
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
    baselineBuildNumbers: [],
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
    comparisonProfile: "docker-ab",
    jsonPath: "ci-io.json",
    markdownPath: "ci-io.md",
    benchmark: Bun.env["CI_IO_OBSERVE"] === "true",
    enforceAbGates: false,
    annotate: false,
    help: false,
  };
}

function parseBuildNumbers(value: string): number[] {
  return value
    .split(",")
    .map((part) => z.coerce.number().int().positive().parse(part));
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
    case "--baseline-build":
      return {
        ...options,
        baselineBuildNumbers: [
          ...options.baselineBuildNumbers,
          ...parseBuildNumbers(value),
        ],
      };
    case "--fixture-step":
      return { ...options, fixtureSteps: [...options.fixtureSteps, value] };
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
    case "--comparison-profile":
      return { ...options, comparisonProfile: value };
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

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
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
      default:
        options = applyValueFlag(
          options,
          flag,
          requiredValue(args, index, flag),
        );
        index += 1;
    }
  }
  return CliOptionsSchema.parse(options);
}
