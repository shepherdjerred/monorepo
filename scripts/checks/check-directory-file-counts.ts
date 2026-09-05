/**
 * Directory file-count governance.
 *
 * A flat directory stops being a domain and becomes a dumping ground somewhere
 * past fifty modules. This check draws that line mechanically.
 *
 * Two budgets per directory, counted independently: source files and colocated
 * test files. A `foo.test.ts` is not a new concept, so it must not consume the
 * module budget — a directory may hold fifty modules and their fifty tests.
 *
 * There is no allowlist and no exempt path. While the repository is being
 * reorganized, `CEILING` sits above `TARGET` and is lowered by each
 * reorganization PR; it is a single global number, so no directory is ever
 * individually excused, and nothing new may exceed today's worst case.
 */

import { trackedExistingFiles } from "../lib/tracked-files.ts";

/** Lowered by each reorganization PR until it reaches `TARGET`. */
export const CEILING = 66;

/** The permanent limit. When `CEILING` reaches this, the workstream is done. */
export const TARGET = 50;

/** Advisory only — never affects the exit code. */
export const WARN_THRESHOLD = 25;

const CODE_EXTENSIONS = new Set([
  "astro",
  "cjs",
  "cs",
  "go",
  "js",
  "jsx",
  "mjs",
  "py",
  "rs",
  "swift",
  "ts",
  "tsx",
]);

/**
 * `sandbox/` is excluded deliberately: `sandbox/archive` is marked
 * do-not-modify, so a rule that could block it is a rule that cannot be obeyed.
 */
const EXCLUDED_PREFIX = "sandbox/";

/**
 * Test-file conventions, one per in-scope language.
 *
 * The budget split only means anything if a test is recognised as a test in
 * whatever language it is written in. Charging `foo_test.go` or `FooTests.swift`
 * to the source budget would make a directory of 30 modules and their 30
 * conventionally named tests fail a 50-module limit it never actually exceeded.
 *
 * Each pattern is anchored on its own extension, so no language's convention
 * can classify another language's files.
 */
const TEST_FILE_PATTERNS: readonly RegExp[] = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/u, // JavaScript / TypeScript
  /\.(?:test|spec)\.astro$/u, // Astro
  /_test\.go$/u, // Go
  /(?:^|\/)test_[^/]*\.py$/u, // Python, pytest prefix form
  /_test\.py$/u, // Python, suffix form
  /Tests?\.swift$/u, // Swift, XCTest
  /Tests?\.cs$/u, // C#
  /_test\.rs$/u, // Rust
];

/**
 * Pathspecs handing the extension filter to git, so the existence check runs
 * over the ~5.8k code files rather than all ~23.7k tracked paths. Derived from
 * `CODE_EXTENSIONS` so the two cannot drift. A bare `*.ts` pathspec matches at
 * any depth; `isCountedPath` remains the authority on what counts.
 */
const CODE_PATHSPECS = [...CODE_EXTENSIONS].map(
  (extension) => `*.${extension}`,
);

export type Budget = "source" | "test";

export type DirectoryTally = {
  readonly directory: string;
  readonly source: number;
  readonly test: number;
};

export type Violation = {
  readonly directory: string;
  readonly budget: Budget;
  readonly count: number;
};

/** Whether a path counts toward either budget. */
export function isCountedPath(path: string): boolean {
  if (path.startsWith(EXCLUDED_PREFIX)) return false;
  const extension = path.slice(path.lastIndexOf(".") + 1);
  return CODE_EXTENSIONS.has(extension);
}

export function budgetOf(path: string): Budget {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path))
    ? "test"
    : "source";
}

/** The directory a file is a direct child of. Repository-root files are `"."`. */
export function directoryOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

/** Count both budgets for every directory containing at least one code file. */
export function tallyDirectories(
  paths: readonly string[],
): Map<string, DirectoryTally> {
  const tallies = new Map<string, DirectoryTally>();
  for (const path of paths) {
    if (!isCountedPath(path)) continue;
    const directory = directoryOf(path);
    const current = tallies.get(directory) ?? { directory, source: 0, test: 0 };
    const budget = budgetOf(path);
    tallies.set(directory, {
      directory,
      source: current.source + (budget === "source" ? 1 : 0),
      test: current.test + (budget === "test" ? 1 : 0),
    });
  }
  return tallies;
}

function violationsAbove(
  tallies: Iterable<DirectoryTally>,
  threshold: number,
): Violation[] {
  const found: Violation[] = [];
  for (const tally of tallies) {
    if (tally.source > threshold) {
      found.push({
        directory: tally.directory,
        budget: "source",
        count: tally.source,
      });
    }
    if (tally.test > threshold) {
      found.push({
        directory: tally.directory,
        budget: "test",
        count: tally.test,
      });
    }
  }
  return found.toSorted(
    (left, right) =>
      right.count - left.count || left.directory.localeCompare(right.directory),
  );
}

/** Directories exceeding `ceiling` — these fail the check. */
export function findErrors(
  tallies: Iterable<DirectoryTally>,
  ceiling: number = CEILING,
): Violation[] {
  return violationsAbove(tallies, ceiling);
}

/** Directories over the advisory threshold but within `ceiling`. */
export function findWarnings(
  tallies: Iterable<DirectoryTally>,
  ceiling: number = CEILING,
): Violation[] {
  return violationsAbove(tallies, WARN_THRESHOLD).filter(
    (violation) => violation.count <= ceiling,
  );
}

/**
 * Directories to report on.
 *
 * In staged mode the caller passes the files being committed, but the answer
 * still has to come from each directory's *full* contents: counting only the
 * staged files would report `1` for a single file added to a sixty-file
 * directory and pass. So the requested paths select directories; they never
 * supply the counts.
 */
export function reportedDirectories(
  requestedPaths: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (requestedPaths === undefined || requestedPaths.length === 0) {
    return undefined;
  }
  return new Set(
    requestedPaths
      .filter((path) => isCountedPath(path))
      .map((path) => directoryOf(path)),
  );
}

function describe(violation: Violation): string {
  const noun = violation.budget === "source" ? "source" : "test";
  return `${violation.directory} has ${violation.count.toString()} ${noun} files`;
}

export async function checkDirectoryFileCounts(
  requestedPaths?: readonly string[],
): Promise<void> {
  const selected = reportedDirectories(requestedPaths);
  const allTallies = tallyDirectories(
    await trackedExistingFiles(CODE_PATHSPECS),
  );
  const tallies = [...allTallies.values()].filter(
    (tally) => selected === undefined || selected.has(tally.directory),
  );

  for (const warning of findWarnings(tallies)) {
    console.log(
      `WARN: ${describe(warning)} (over ${WARN_THRESHOLD.toString()}). Consider splitting into sub-domains.`,
    );
  }

  const errors = findErrors(tallies);
  for (const error of errors) {
    console.error(
      `ERROR: ${describe(error)} (limit ${CEILING.toString()}). Split into sub-domains.`,
    );
  }
  if (errors.length > 0) {
    throw new Error(
      `${errors.length.toString()} directory budget(s) exceed the limit of ${CEILING.toString()}.`,
    );
  }
}

if (import.meta.main) {
  const requestedPaths = Bun.argv.slice(2);
  await checkDirectoryFileCounts(
    requestedPaths.length === 0 ? undefined : requestedPaths,
  );
}
