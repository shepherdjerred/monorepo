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
 * The markdown is written to .ci-reports and printed to the step log.
 *
 * Buildkite piped it to `buildkite-agent annotate`, which rendered it on the
 * build page. Woodpecker has no annotation surface, so the report lives in the
 * files and the log instead. Nothing read an annotation back, so no consumer
 * lost anything -- only the rendering did.
 *
 * Usage: bun scripts/ci/annotate-turbo-summary.ts
 */
import path from "node:path";
import { buildUrl } from "../lib/ci/ci-environment.ts";
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

const runsDir = new URL("../../.turbo/runs", import.meta.url).pathname;
const file = newestRunFile(runsDir);
const summary = TurboRunSummarySchema.parse(await Bun.file(file).json());
const report = buildCiTaskReport(summary, buildUrl(), Bun.env["CI_STEP_NAME"]);
const outputDirectory = new URL("../../.ci-reports/tasks", import.meta.url)
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
console.log(renderCiTaskReport(report, false));
