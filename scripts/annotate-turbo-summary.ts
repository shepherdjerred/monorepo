#!/usr/bin/env bun
/**
 * Post a Buildkite annotation summarizing the most recent turbo run.
 *
 * The verify step runs turbo with `--summarize`, which writes a run summary
 * JSON to .turbo/runs/<id>.json. This reads the newest one and renders a
 * markdown table: executed / cache-hit / failed counts plus per-failure
 * durations — the modern replacement for the old CI's build-summary
 * meta-data plumbing.
 *
 * In CI (BUILDKITE=true) the markdown is piped to `buildkite-agent annotate`
 * and a missing agent binary is a hard error. Locally it prints to stdout.
 *
 * Usage: bun scripts/annotate-turbo-summary.ts
 */
import path from "node:path";
import {
  buildCiTaskReport,
  renderCiTaskReport,
  TurboRunSummarySchema,
} from "./ci-task-summary.ts";

function newestRunFile(dir: string): string {
  // Summary filenames embed a monotonic run id; lexicographic max = newest.
  const files = [...new Bun.Glob("*.json").scanSync(dir)].sort();
  const newest = files.at(-1);
  if (newest === undefined) {
    throw new Error(`no turbo run summaries found in ${dir}`);
  }
  return `${dir}/${newest}`;
}

const runsDir = new URL("../.turbo/runs", import.meta.url).pathname;
const file = newestRunFile(runsDir);
const summary = TurboRunSummarySchema.parse(await Bun.file(file).json());
const report = buildCiTaskReport(
  summary,
  Bun.env["BUILDKITE_BUILD_URL"],
  Bun.env["BUILDKITE_JOB_ID"],
);
const outputDirectory = new URL("../.ci-reports/tasks", import.meta.url)
  .pathname;
await Bun.$`mkdir -p ${outputDirectory}`;
await Promise.all([
  Bun.write(
    path.join(outputDirectory, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  ),
  Bun.write(
    path.join(outputDirectory, "summary.md"),
    renderCiTaskReport(report, true),
  ),
]);
const markdown = renderCiTaskReport(report, false);

if (Bun.env["BUILDKITE"] === "true") {
  const style = report.run.failed > 0 ? "error" : "success";
  const proc = Bun.spawnSync(
    [
      "buildkite-agent",
      "annotate",
      "--style",
      style,
      "--context",
      "turbo-summary",
    ],
    {
      stdin: new TextEncoder().encode(markdown),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`buildkite-agent annotate exited ${String(proc.exitCode)}`);
  }
} else {
  console.log(markdown);
}
