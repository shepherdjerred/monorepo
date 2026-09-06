#!/usr/bin/env bun

import path from "node:path";
import { rm } from "node:fs/promises";
import { asRecord } from "../../../scripts/lib/json.ts";
import {
  allPlaywrightTargets,
  PLAYWRIGHT_TARGETS,
  selectPlaywrightTargets,
  type PlaywrightSelection,
} from "./playwright-targets.ts";

const REPORT_PATH = "playwright-selection-report.json";

type TaskCache = Record<string, string>;

async function run(command: readonly string[]): Promise<number> {
  const child = Bun.spawn([...command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: Bun.env,
  });
  return child.exited;
}

async function validBase(base: string): Promise<boolean> {
  for (const command of [
    ["git", "cat-file", "-e", `${base}^{commit}`],
    ["git", "merge-base", "--is-ancestor", base, "HEAD"],
  ]) {
    if ((await run(command)) !== 0) return false;
  }
  return true;
}

async function changedPaths(base: string): Promise<string[]> {
  const child = Bun.spawn(
    ["git", "diff", "--no-renames", "--name-only", base, "HEAD"],
    { stdout: "pipe", stderr: "inherit", env: Bun.env },
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error("git diff failed");
  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

async function selectionForBuild(): Promise<{
  readonly base: string | null;
  readonly changedPaths: readonly string[];
  readonly selection: PlaywrightSelection;
}> {
  if (Bun.env["CI_IO_FIXED_CORPUS"] === "true") {
    return {
      base: null,
      changedPaths: [],
      selection: allPlaywrightTargets("fixed CI I/O corpus requested"),
    };
  }
  const base = Bun.env["CI_CHANGED_BASE"]?.trim();
  if (base === undefined || base === "" || !(await validBase(base))) {
    return {
      base: null,
      changedPaths: [],
      selection: allPlaywrightTargets(
        "changed-file base unavailable or invalid (fail-open)",
      ),
    };
  }
  const paths = await changedPaths(base);
  try {
    return {
      base,
      changedPaths: paths,
      selection: await selectPlaywrightTargets(paths),
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      base,
      changedPaths: paths,
      selection: allPlaywrightTargets(`browser selector failed: ${reason}`),
    };
  }
}

async function playwrightTurboSummary(): Promise<Record<string, unknown>> {
  const directory = ".turbo/runs";
  const files = [...new Bun.Glob("*.json").scanSync(directory)];
  if (files.length !== 1) {
    throw new Error(
      `expected one Playwright Turbo summary, found ${files.length.toString()}`,
    );
  }
  const summary = files[0];
  if (summary === undefined)
    throw new Error("Playwright Turbo summary is missing");
  const raw: unknown = await Bun.file(path.join(directory, summary)).json();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("Playwright Turbo summary must be an object");
  }
  return Object.fromEntries(Object.entries(raw));
}

async function taskCacheStatuses(
  selectedPackages: ReadonlySet<string>,
): Promise<TaskCache> {
  const summary = await playwrightTurboSummary();
  const tasks = summary["tasks"];
  if (!Array.isArray(tasks)) {
    throw new TypeError("Playwright Turbo summary tasks must be an array");
  }
  const statuses: TaskCache = {};
  for (const raw of tasks) {
    const task = asRecord(raw);
    if (task === null) continue;
    const packageName = task["package"];
    if (
      typeof packageName !== "string" ||
      !selectedPackages.has(packageName) ||
      task["task"] !== "test:e2e"
    ) {
      continue;
    }
    const cache = asRecord(task["cache"]);
    if (cache === null) {
      statuses[packageName] = "UNKNOWN";
      continue;
    }
    const status = cache["status"];
    statuses[packageName] = typeof status === "string" ? status : "UNKNOWN";
  }
  for (const packageName of selectedPackages) {
    if (statuses[packageName] === undefined) {
      throw new Error(`Turbo did not report ${packageName}#test:e2e`);
    }
  }
  return statuses;
}

async function writeReport(options: {
  readonly base: string | null;
  readonly changedPaths: readonly string[];
  readonly selection: PlaywrightSelection;
  readonly cache?: TaskCache;
}): Promise<void> {
  await Bun.write(
    REPORT_PATH,
    `${JSON.stringify(
      {
        version: 1,
        base: options.base,
        changedPaths: options.changedPaths,
        mode: options.selection.mode,
        globalReason: options.selection.globalReason,
        targets: options.selection.targets.map((target) => ({
          package: target.package,
          reasons: options.selection.reasons[target.package] ?? [],
          cache: options.cache?.[target.package] ?? "NOT_RUN",
        })),
      },
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<number> {
  const context = await selectionForBuild();
  await writeReport(context);
  const selectedPackages = context.selection.targets.map(
    (target) => target.package,
  );
  if (selectedPackages.length === 0) {
    console.log("Browser E2E: no affected targets");
    return 0;
  }
  console.log(`Browser E2E targets: ${selectedPackages.join(", ")}`);
  await rm(".ci-reports", { recursive: true, force: true });

  const installFilters = new Set([
    "@shepherdjerred/monorepo",
    "@shepherdjerred/root-scripts",
    ...selectedPackages,
  ]);
  if (selectedPackages.some((name) => name.startsWith("@scout-for-lol/"))) {
    installFilters.add("scout-for-lol");
  }
  const installStatus = await run([
    ".buildkite/scripts/bun-install.sh",
    "--frozen-lockfile",
    ...[...installFilters].flatMap((name) => ["--filter", name]),
  ]);
  if (installStatus !== 0) return installStatus;

  if (selectedPackages.includes("sjer.red")) {
    const sjerStatus = await run([
      "bun",
      "x",
      "--no-install",
      "turbo",
      "run",
      "build",
      "lint",
      "test",
      "--filter=sjer.red",
      "--concurrency=2",
    ]);
    if (sjerStatus !== 0) return sjerStatus;
  }

  await rm(".turbo/runs", { recursive: true, force: true });
  const e2eStatus = await run([
    "bun",
    "x",
    "--no-install",
    "turbo",
    "run",
    "test:e2e",
    ...selectedPackages.map((name) => `--filter=${name}`),
    "--concurrency=2",
    "--summarize",
  ]);
  if (e2eStatus !== 0) return e2eStatus;

  const selectedSet = new Set(selectedPackages);
  const cache = await taskCacheStatuses(selectedSet);
  for (const target of PLAYWRIGHT_TARGETS) {
    if (!selectedSet.has(target.package) || cache[target.package] === "HIT") {
      continue;
    }
    const report = `.ci-reports/junit/${target.reportDirectory}/playwright.xml`;
    if (!(await Bun.file(report).exists()) || Bun.file(report).size === 0) {
      throw new Error(
        `${target.package} executed without a non-empty Playwright JUnit report`,
      );
    }
  }
  await writeReport({ ...context, cache });

  for (const command of [
    ["bun", "--no-install", "scripts/ci/namespace-playwright-reports.ts"],
    ["bun", "--no-install", "scripts/ci/write-ci-report-index.ts"],
  ]) {
    const status = await run(command);
    if (status !== 0) return status;
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main();
