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
import { createS3Client } from "#lib/s3/client.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";

const USAGE = `toolkit ci analyze [--since 72h] [--top 15] [--churn-days 30] [--ref origin/main] [--no-hot-files] [--profile NAME] [--json]

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
`;

const FINISHED = new Set(["success", "failure", "killed", "error"]);
const DOWNLOAD_CONCURRENCY = 4;

async function loadRuns(
  numbers: readonly number[],
  profile: string,
): Promise<VerifyRun[]> {
  const client = createS3Client(profile);
  const cacheDirectory = analyzeCacheDirectory();
  const runs: VerifyRun[] = [];
  for (let index = 0; index < numbers.length; index += DOWNLOAD_CONCURRENCY) {
    const batch = await Promise.all(
      numbers
        .slice(index, index + DOWNLOAD_CONCURRENCY)
        .map((number) => loadVerifyRun(client, number, cacheDirectory)),
    );
    runs.push(...batch.filter((run) => run !== null));
  }
  return runs;
}

function minutes(seconds: number | null): string {
  return seconds === null ? "-" : `${(seconds / 60).toFixed(1)}m`;
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
    },
  });
  const top = z.coerce.number().int().positive().parse(values.top);
  const churnDays = z.coerce
    .number()
    .int()
    .positive()
    .parse(values["churn-days"]);

  await authenticate();
  const config = await loadWoodpeckerConfig();
  const until = Date.now() / 1000;
  const since = until - parseTimeout(values.since, "--since") / 1000;
  const pipelines = await pipelineHistory(config, since, until);
  const numbers = pipelines
    .filter(
      (pipeline) =>
        FINISHED.has(pipeline.status) &&
        ["ready-pr", "main"].includes(pipelineKind(pipeline)),
    )
    .map((pipeline) => pipeline.number);
  const runs = await loadRuns(numbers, values.profile);
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
