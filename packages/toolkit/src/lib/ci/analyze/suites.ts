import type { RunSuite, VerifyRun } from "./runs.ts";

/**
 * A run's slowest JUnit suites. Empty when the run recorded none; callers
 * distinguish "none recorded" (`suites === null`, diagnostics older than
 * per-suite collection) from "nothing executed" themselves.
 */
export function slowestSuites(run: VerifyRun, count: number): RunSuite[] {
  return (run.suites ?? [])
    .toSorted((left, right) => right.seconds - left.seconds)
    .slice(0, count);
}

export type SuiteDelta = {
  readonly name: string;
  /** Seconds in the earlier run; null when it did not execute there. */
  readonly before: number | null;
  /** Seconds in the later run; null when it did not execute there. */
  readonly after: number | null;
  /** `after - before`; null when either side is missing. */
  readonly delta: number | null;
};

/** Seconds per suite name; a name reported by several steps sums. */
function secondsByName(run: VerifyRun): Map<string, number> {
  const seconds = new Map<string, number>();
  for (const suite of run.suites ?? []) {
    seconds.set(suite.name, (seconds.get(suite.name) ?? 0) + suite.seconds);
  }
  return seconds;
}

/**
 * Per-suite seconds from `before` to `after`. Suites both runs executed come
 * first by the size of their change; suites only one run executed follow,
 * marked by a null side, largest first. Reports exist only for executed test
 * tasks, so a suite missing on one side usually means its task was cached.
 */
export function compareSuites(
  before: VerifyRun,
  after: VerifyRun,
): SuiteDelta[] {
  const earlier = secondsByName(before);
  const later = secondsByName(after);
  const deltas: SuiteDelta[] = [];
  for (const name of new Set([...earlier.keys(), ...later.keys()])) {
    const beforeSeconds = earlier.get(name) ?? null;
    const afterSeconds = later.get(name) ?? null;
    deltas.push({
      name,
      before: beforeSeconds,
      after: afterSeconds,
      delta:
        beforeSeconds === null || afterSeconds === null
          ? null
          : afterSeconds - beforeSeconds,
    });
  }
  return deltas.toSorted((left, right) =>
    group(left) === group(right)
      ? left.delta !== null && right.delta !== null
        ? Math.abs(right.delta) - Math.abs(left.delta)
        : presentSeconds(right) - presentSeconds(left)
      : group(left) - group(right),
  );
}

/** Suites both runs executed sort before suites only one did. */
function group(delta: SuiteDelta): number {
  return delta.delta === null ? 1 : 0;
}

function presentSeconds(delta: SuiteDelta): number {
  return delta.before ?? delta.after ?? 0;
}

export type SuiteComparisonSummary = {
  readonly compared: number;
  readonly onlyBefore: { readonly suites: number; readonly seconds: number };
  readonly onlyAfter: { readonly suites: number; readonly seconds: number };
};

/** How many suites each side executed alone, and their total seconds. */
export function summarizeComparison(
  deltas: readonly SuiteDelta[],
): SuiteComparisonSummary {
  const onlyBefore = deltas.filter((delta) => delta.after === null);
  const onlyAfter = deltas.filter((delta) => delta.before === null);
  return {
    compared: deltas.length - onlyBefore.length - onlyAfter.length,
    onlyBefore: {
      suites: onlyBefore.length,
      seconds: onlyBefore.reduce((sum, delta) => sum + (delta.before ?? 0), 0),
    },
    onlyAfter: {
      suites: onlyAfter.length,
      seconds: onlyAfter.reduce((sum, delta) => sum + (delta.after ?? 0), 0),
    },
  };
}
