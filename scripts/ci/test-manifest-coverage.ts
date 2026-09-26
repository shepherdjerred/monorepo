/**
 * Proves the CI test manifest runs every JavaScript/TypeScript test file.
 *
 * A package's own `test` script and its manifest steps are written separately,
 * so a suite added to one silently never runs in CI. This check reads the
 * tracked test files instead of either list: each one must be selected by a
 * Vitest step or named in the workspace's `excludedSuites` with the reason it
 * runs elsewhere. A CLI `--exclude` alone is not evidence that a test runs.
 */
import type { TestManifest, TestStep } from "./ci-reporting.ts";
import { minimatch } from "minimatch";

type Workspace = TestManifest["workspaces"][number];
type VitestStep = Extract<TestStep, { runner: "vitest" }>;

/** Vitest's default include: `**\/*.{test,spec}.?(c|m)[jt]s?(x)`. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** Vitest CLI options whose value is the following argument. */
const OPTIONS_WITH_VALUES = new Set([
  "--config",
  "--dir",
  "--exclude",
  "--hookTimeout",
  "--maxWorkers",
  "--pool",
  "--project",
  "--reporter",
  "--shard",
  "--testTimeout",
]);

type VitestSelection = {
  readonly filters: readonly string[];
  readonly excludes: readonly string[];
  readonly directories: readonly string[];
};

export function vitestSelection(step: VitestStep): VitestSelection {
  const filters: string[] = [];
  const excludes: string[] = [];
  const directories: string[] = [];
  const args = step.args ?? [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--")) {
      filters.push(arg);
      continue;
    }
    if (arg.startsWith("--dir=")) {
      directories.push(arg.slice("--dir=".length));
      continue;
    }
    if (arg.startsWith("--exclude=")) {
      excludes.push(arg.slice("--exclude=".length));
      continue;
    }
    if (arg.includes("=") || !OPTIONS_WITH_VALUES.has(arg)) continue;
    const value = args[++index];
    if (value === undefined) {
      throw new Error(`Vitest option ${arg} has no value`);
    }
    if (arg === "--exclude") excludes.push(value);
    if (arg === "--dir") directories.push(value);
  }
  return { filters, excludes, directories };
}

function isUnder(file: string, path: string): boolean {
  const directory = path.replace(/\/+$/u, "");
  return file === directory || file.startsWith(`${directory}/`);
}

/** Whether a manifest step or exclusion accounts for a workspace-relative file. */
export function isAccountedFor(workspace: Workspace, file: string): boolean {
  const excluded = workspace.excludedSuites ?? [];
  if (excluded.some((suite) => isUnder(file, suite.path))) return true;
  return workspace.steps.some((step) => {
    if (step.runner !== "vitest") return false;
    const { filters, excludes, directories } = vitestSelection(step);
    // `--dir` is the Vitest root and limits which files this step can discover.
    if (
      directories.length > 0 &&
      !directories.some((directory) => isUnder(file, directory))
    ) {
      return false;
    }
    // An explicit exclusion is not evidence that this file runs elsewhere.
    if (excludes.some((exclude) => minimatch(file, exclude))) return false;
    // Vitest matches positional filters as substrings of the file path.
    return (
      filters.length === 0 || filters.some((filter) => file.includes(filter))
    );
  });
}

/**
 * Test files a workspace owns, relative to it. Nested workspaces own their own
 * files. The root scripts workspace also owns `.buildkite/scripts/`, which its
 * Vitest config includes as `../.buildkite/scripts`.
 */
export function workspaceTestFiles(
  workspace: Workspace,
  trackedFiles: readonly string[],
  workspaceDirectories: readonly string[],
): string[] {
  const nested = workspaceDirectories.filter(
    (directory) =>
      directory !== workspace.directory &&
      directory.startsWith(`${workspace.directory}/`),
  );
  const files: string[] = [];
  for (const file of trackedFiles) {
    if (!TEST_FILE.test(file)) continue;
    if (isUnder(file, workspace.directory)) {
      if (nested.some((directory) => isUnder(file, directory))) continue;
      files.push(file.slice(workspace.directory.length + 1));
    } else if (
      workspace.directory === "scripts" &&
      isUnder(file, ".buildkite/scripts")
    ) {
      files.push(`../${file}`);
    }
  }
  return files;
}

export function unrunTestFiles(
  manifest: TestManifest,
  trackedFiles: readonly string[],
  workspaceDirectories: readonly string[],
): string[] {
  return manifest.workspaces.flatMap((workspace) =>
    workspaceTestFiles(workspace, trackedFiles, workspaceDirectories)
      .filter((file) => !isAccountedFor(workspace, file))
      .map(
        (file) =>
          `scripts/ci-test-manifest.json (${workspace.package}): no step runs ${file}; add it to a step or to excludedSuites with the reason it runs elsewhere`,
      ),
  );
}
