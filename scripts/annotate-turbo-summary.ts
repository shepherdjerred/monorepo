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
import { z } from "zod";

const TaskSummarySchema = z.object({
  taskId: z.string(),
  execution: z
    .object({
      exitCode: z.number().nullable().optional(),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
    })
    .optional(),
  cache: z.object({ status: z.string() }).optional(),
});

const RunSummarySchema = z.object({
  execution: z.object({
    attempted: z.number(),
    cached: z.number(),
    failed: z.number(),
    success: z.number(),
    startTime: z.number(),
    endTime: z.number(),
  }),
  tasks: z.array(TaskSummarySchema),
});

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
const summary = RunSummarySchema.parse(await Bun.file(file).json());

const { attempted, cached, failed, success, startTime, endTime } =
  summary.execution;
const wallSeconds = ((endTime - startTime) / 1000).toFixed(1);

const failures = summary.tasks.filter(
  (t) => (t.execution?.exitCode ?? 0) !== 0,
);

const lines: string[] = [
  `### :turborepo: verify — ${String(attempted)} tasks in ${wallSeconds}s`,
  "",
  "| Executed | Cache hits | Failed |",
  "| --- | --- | --- |",
  `| ${String(success)} | ${String(cached)} | ${String(failed)} |`,
];

if (failures.length > 0) {
  lines.push(
    "",
    "**Failed tasks**",
    "",
    "| Task | Duration |",
    "| --- | --- |",
  );
  for (const t of failures) {
    const start = t.execution?.startTime;
    const end = t.execution?.endTime;
    const duration =
      start !== undefined && end !== undefined
        ? `${((end - start) / 1000).toFixed(1)}s`
        : "?";
    lines.push(`| \`${t.taskId}\` | ${duration} |`);
  }
}

const markdown = lines.join("\n");

if (Bun.env["BUILDKITE"] === "true") {
  const style = failures.length > 0 ? "error" : "success";
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
