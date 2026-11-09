import type { S3Client } from "@aws-sdk/client-s3";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parseTimeout } from "#lib/ci/arguments.ts";
import { pipelineHistory } from "#lib/ci/history.ts";
import { pipelineKind } from "#lib/ci/latency.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import {
  collectHotFileInputs,
  repositoryTopLevel,
} from "#lib/ci/analyze/graph.ts";
import {
  criticalTasks,
  hotFiles,
  missCosts,
  repeatedMisses,
  uncachedTasks,
} from "#lib/ci/analyze/report.ts";
import {
  analyzeCacheDirectory,
  loadVerifyRun,
  type VerifyRun,
} from "#lib/ci/analyze/runs.ts";
import {
  compareSuites,
  slowestSuites,
  summarizeComparison,
  type SuiteDelta,
  type SuiteComparisonSummary,
} from "#lib/ci/analyze/suites.ts";
import { createS3Client } from "#lib/s3/client.ts";
import {
  loadWoodpeckerConfig,
  type WoodpeckerConfig,
} from "#lib/woodpecker/ci.ts";

const USAGE = `toolkit ci analyze [--since 72h] [--top 15] [--churn-days 30] [--ref origin/main] [--no-hot-files] [--profile NAME] [--json]
toolkit ci analyze --suites [--pipeline N] [--compare N] [--top 15] [--since 72h] [--profile NAME] [--json]

Where verify's executed work goes, from each finished ready-PR and main
pipeline's Turbo diagnostics in ci-handoff (AWS profile, default seaweedfs;
compacted under ~/.cache/toolkit/ci-analyze):

  uncached    executed tasks by total seconds
  critical    the task each run finished last on, with median run wall time
  repeated    misses whose own inputs an earlier run already executed: only an
              upstream (dependsOn) hash, the global hash or the cache
              namespace differed
  hot files   files ranked by expected executed seconds per week: commits on
              --ref in --churn-days times the median miss cost of every task
              hash the file reaches, directly or through dependsOn. Reads
              verify's graph with turbo --dry=json from the current checkout.
  --suites    the slowest JUnit suites (test files) one run executed: the
              newest finished ready-PR or main pipeline in --since, or
              --pipeline N. With --compare N, the largest per-suite changes
              from pipeline N to that run; suites only one of them executed
              follow, marked "-" on the missing side. Reports exist only for
              test tasks that ran, so a cached task's suites are absent.
`;

const FINISHED = new Set(["success", "failure", "killed", "error"]);
const DOWNLOAD_CONCURRENCY = 4;
const PipelineNumber = z.coerce.number().int().positive();

type Store = { readonly client: S3Client; readonly cacheDirectory: string };

async function loadRuns(
  store: Store,
  numbers: readonly number[],
): Promise<VerifyRun[]> {
  const runs: VerifyRun[] = [];
  for (let index = 0; index < numbers.length; index += DOWNLOAD_CONCURRENCY) {
    const batch = await Promise.all(
      numbers
        .slice(index, index + DOWNLOAD_CONCURRENCY)
        .map((number) =>
          loadVerifyRun(store.client, number, store.cacheDirectory),
        ),
    );
    runs.push(...batch.filter((run) => run !== null));
  }
  return runs;
}

/** Finished ready-PR and main pipelines in the window, newest first. */
async function windowPipelines(
  config: WoodpeckerConfig,
  since: number,
  until: number,
): Promise<number[]> {
  const pipelines = await pipelineHistory(config, since, until);
  return pipelines
    .filter(
      (pipeline) =>
        FINISHED.has(pipeline.status) &&
        ["ready-pr", "main"].includes(pipelineKind(pipeline)),
    )
    .map((pipeline) => pipeline.number)
    .toSorted((left, right) => right - left);
}

function minutes(seconds: number | null): string {
  return seconds === null ? "-" : `${(seconds / 60).toFixed(1)}m`;
}

function formatSeconds(value: number | null, signed = false): string {
  if (value === null) return "-";
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}s`;
}

type Report = {
  readonly window: { readonly since: string; readonly until: string };
  readonly runs: number;
  readonly uncached: ReturnType<typeof uncachedTasks>;
  readonly critical: ReturnType<typeof criticalTasks>;
  readonly repeated: ReturnType<typeof repeatedMisses>;
  readonly hotFiles: ReturnType<typeof hotFiles> | null;
};

function formatReport(report: Report): string {
  const lines = [
    `${String(report.runs)} verify runs with diagnostics: ${report.window.since} — ${report.window.until}`,
    "",
    "Uncached work (total, runs, p50, max):",
    ...report.uncached.map(
      (task) =>
        `  ${minutes(task.totalSeconds).padStart(8)}  ${String(task.runs).padStart(4)}  ${minutes(task.p50Seconds).padStart(7)}  ${minutes(task.maxSeconds).padStart(7)}  ${task.task}`,
    ),
    "",
    "Critical path (runs ending on the task, median run wall time):",
    ...report.critical.map(
      (task) =>
        `  ${String(task.runs).padStart(4)}  ${minutes(task.medianWallSeconds).padStart(7)}  ${task.task}`,
    ),
    "",
    "Repeated misses with unchanged own inputs (seconds, repeated/misses):",
    ...report.repeated.map(
      (task) =>
        `  ${minutes(task.repeatedSeconds).padStart(8)}  ${String(task.repeated)}/${String(task.misses)}  ${task.task}`,
    ),
  ];
  if (report.hotFiles !== null) {
    lines.push(
      "",
      "Hot files (executed per week, commits, per edit, tasks reached):",
      ...report.hotFiles.map(
        (file) =>
          `  ${minutes(file.weeklySeconds).padStart(8)}  ${String(file.commits).padStart(4)}  ${minutes(file.secondsPerEdit).padStart(7)}  ${String(file.tasks).padStart(4)}  ${file.file}`,
      ),
    );
  }
  return lines.join("\n");
}

type RunIdentity = { readonly pipeline: number; readonly commit: string };

type SuitesReport =
  | {
      readonly run: RunIdentity;
      readonly recorded: number;
      readonly slowest: ReturnType<typeof slowestSuites>;
    }
  | {
      readonly before: RunIdentity;
      readonly after: RunIdentity;
      readonly deltas: SuiteDelta[];
      readonly summary: SuiteComparisonSummary;
    };

function identity(run: VerifyRun): RunIdentity {
  return { pipeline: run.pipeline, commit: run.commit };
}

function label(run: RunIdentity): string {
  return `pipeline ${String(run.pipeline)} (${run.commit.slice(0, 10)})`;
}

function formatSuites(report: SuitesReport): string {
  if ("run" in report) {
    if (report.recorded === 0)
      return `${label(report.run)} executed no test suites: every test task was cached.`;
    return [
      `Slowest of ${String(report.recorded)} suites in ${label(report.run)} (seconds, tests, failures, suite, report):`,
      ...report.slowest.map(
        (suite) =>
          `  ${formatSeconds(suite.seconds).padStart(9)}  ${String(suite.tests).padStart(5)}  ${String(suite.failures).padStart(4)}  ${suite.name}  ${suite.report}`,
      ),
    ].join("\n");
  }
  const { summary } = report;
  return [
    `Suite seconds from ${label(report.before)} to ${label(report.after)} (before, after, change, suite):`,
    ...report.deltas.map(
      (delta) =>
        `  ${formatSeconds(delta.before).padStart(9)}  ${formatSeconds(delta.after).padStart(9)}  ${formatSeconds(delta.delta, true).padStart(8)}  ${delta.name}`,
    ),
    "",
    `${String(summary.compared)} suites ran in both; ${String(summary.onlyBefore.suites)} only in ${String(report.before.pipeline)} (${formatSeconds(summary.onlyBefore.seconds)}), ${String(summary.onlyAfter.suites)} only in ${String(report.after.pipeline)} (${formatSeconds(summary.onlyAfter.seconds)}).`,
  ].join("\n");
}

/** A named pipeline's run, or the newest in the window with diagnostics. */
async function suiteRun(
  store: Store,
  pipeline: number | undefined,
  pipelines: () => Promise<number[]>,
): Promise<VerifyRun> {
  let run: VerifyRun | null = null;
  if (pipeline === undefined) {
    for (const number of await pipelines()) {
      run = await loadVerifyRun(store.client, number, store.cacheDirectory);
      if (run !== null) break;
    }
    if (run === null)
      throw new Error("No verify diagnostics found in the window");
  } else {
    run = await loadVerifyRun(store.client, pipeline, store.cacheDirectory);
    if (run === null)
      throw new Error(`Pipeline ${String(pipeline)} has no verify diagnostics`);
  }
  if (run.suites === null)
    throw new Error(
      `${label(identity(run))} recorded no per-suite timings: its diagnostics predate them`,
    );
  return run;
}

async function suitesReport(
  store: Store,
  options: {
    readonly pipeline: number | undefined;
    readonly compare: number | undefined;
    readonly top: number;
  },
  pipelines: () => Promise<number[]>,
): Promise<SuitesReport> {
  const after = await suiteRun(store, options.pipeline, pipelines);
  if (options.compare === undefined) {
    return {
      run: identity(after),
      recorded: after.suites?.length ?? 0,
      slowest: slowestSuites(after, options.top),
    };
  }
  const before = await suiteRun(store, options.compare, pipelines);
  const deltas = compareSuites(before, after);
  return {
    before: identity(before),
    after: identity(after),
    deltas: deltas.slice(0, options.top),
    summary: summarizeComparison(deltas),
  };
}

/** Parses before `authenticate`, so help and bad flags need no credentials. */
export async function ciAnalyzeCommand(
  args: string[],
  authenticate: () => Promise<void>,
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      since: { type: "string", default: "72h" },
      top: { type: "string", default: "15" },
      "churn-days": { type: "string", default: "30" },
      ref: { type: "string", default: "origin/main" },
      "no-hot-files": { type: "boolean", default: false },
      profile: { type: "string", default: "seaweedfs" },
      json: { type: "boolean", default: false },
      suites: { type: "boolean", default: false },
      pipeline: { type: "string" },
      compare: { type: "string" },
    },
  });
  const top = z.coerce.number().int().positive().parse(values.top);
  const churnDays = z.coerce
    .number()
    .int()
    .positive()
    .parse(values["churn-days"]);
  if (!values.suites && (values.pipeline ?? values.compare) !== undefined)
    throw new Error("--pipeline and --compare require --suites");
  const pipeline =
    values.pipeline === undefined
      ? undefined
      : PipelineNumber.parse(values.pipeline);
  const compare =
    values.compare === undefined
      ? undefined
      : PipelineNumber.parse(values.compare);
  const windowSeconds = parseTimeout(values.since, "--since") / 1000;

  await authenticate();
  const config = await loadWoodpeckerConfig();
  const until = Date.now() / 1000;
  const since = until - windowSeconds;
  const store: Store = {
    client: await createS3Client(values.profile),
    cacheDirectory: analyzeCacheDirectory(),
  };
  const pipelines = () => windowPipelines(config, since, until);

  if (values.suites) {
    const report = await suitesReport(
      store,
      { pipeline, compare, top },
      pipelines,
    );
    console.log(
      sanitizeText(
        values.json ? JSON.stringify(report, null, 2) : formatSuites(report),
        [config.token],
      ),
    );
    return;
  }

  const runs = await loadRuns(store, await pipelines());
  if (runs.length === 0)
    throw new Error("No verify diagnostics found in the window");

  let hot: Report["hotFiles"] = null;
  if (!values["no-hot-files"]) {
    const repositoryRoot = await repositoryTopLevel();
    const { graph, commits } = await collectHotFileInputs(
      repositoryRoot,
      churnDays,
      values.ref,
    );
    hot = hotFiles(graph, commits, missCosts(runs), churnDays).slice(0, top);
  }
  const report: Report = {
    window: {
      since: new Date(since * 1000).toISOString(),
      until: new Date(until * 1000).toISOString(),
    },
    runs: runs.length,
    uncached: uncachedTasks(runs).slice(0, top),
    critical: criticalTasks(runs).slice(0, top),
    repeated: repeatedMisses(runs).slice(0, top),
    hotFiles: hot,
  };
  console.log(
    sanitizeText(
      values.json ? JSON.stringify(report, null, 2) : formatReport(report),
      [config.token],
    ),
  );
}
