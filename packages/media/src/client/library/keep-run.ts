import type { KeepOutcome, KeepOutcomes } from "./keep-all.ts";
import type { LeavingRow, LeavingTitle } from "./removals.ts";

/**
 * One "keep all" of a title, from its first press until its report is
 * dismissed or everything in it has been kept.
 *
 * A run is about the rows it started with. The removal list is read again
 * after every run, and each kept row leaves it, so the list on screen is not
 * what the run did: counts, per-row results and the retry all come from
 * `title`, the title as it stood when the run began.
 */
export type KeepRun = {
  title: LeavingTitle;
  outcomes: KeepOutcomes;
  running: boolean;
};

/** Runs by the film or series they belong to. */
export type KeepRuns = ReadonlyMap<string, KeepRun>;

function kept(run: KeepRun, row: LeavingRow): boolean {
  return run.outcomes.get(row.removal.mediaId)?.status === "kept";
}

/** Every row the run started with has been kept. */
export function runSucceeded(run: KeepRun): boolean {
  return !run.running && run.title.rows.every((row) => kept(run, row));
}

/** The rows of a run that still have to be kept. */
export function unkeptRows(run: KeepRun): LeavingRow[] {
  return run.title.rows.filter((row) => !kept(run, row));
}

/**
 * A run begins, or begins again for what failed. A run that is still open
 * keeps its rows and results; one that fully succeeded is over, so the next
 * press on the same title starts from the title as it is now.
 */
export function runStarted(runs: KeepRuns, title: LeavingTitle): KeepRuns {
  const open = runs.get(title.rootMediaId);
  const run =
    open === undefined || runSucceeded(open)
      ? { title, outcomes: new Map<string, KeepOutcome>() }
      : open;
  return new Map(runs).set(title.rootMediaId, { ...run, running: true });
}

/** One row's result arrives. */
export function runReported(
  runs: KeepRuns,
  rootMediaId: string,
  report: { mediaId: string; outcome: KeepOutcome },
): KeepRuns {
  const run = runs.get(rootMediaId);
  if (run === undefined) return runs;
  return new Map(runs).set(rootMediaId, {
    ...run,
    outcomes: new Map(run.outcomes).set(report.mediaId, report.outcome),
  });
}

/** Every command of the run has been answered. */
export function runFinished(runs: KeepRuns, rootMediaId: string): KeepRuns {
  const run = runs.get(rootMediaId);
  return run === undefined
    ? runs
    : new Map(runs).set(rootMediaId, { ...run, running: false });
}

/** The reader has read the report. */
export function runDismissed(runs: KeepRuns, rootMediaId: string): KeepRuns {
  const left = new Map(runs);
  left.delete(rootMediaId);
  return left;
}

export type LeavingEntry = {
  rootMediaId: string;
  /** The title as the list has it now; null once none of it is leaving. */
  current: LeavingTitle | null;
  /** The run whose report this entry carries, if any. */
  run: KeepRun | null;
};

/**
 * Whether a run still has something to say about a title. A run with a
 * failure does until it is dismissed, whatever the list says. A run that
 * fully succeeded does only until the list has caught up and dropped its
 * rows; after that it is history, and must not attach itself to a later
 * removal of the same title.
 */
function reports(run: KeepRun, current: LeavingTitle | null): boolean {
  if (!runSucceeded(run)) return true;
  const listed = new Set(current?.rows.map((row) => row.removal.id));
  return run.title.rows.some((row) => listed.has(row.removal.id));
}

/**
 * What Leaving soon shows: every title that is leaving now, with its run's
 * report if it has one, and after them any title whose report is still open
 * although nothing of it is listed any more.
 */
export function leavingEntries(
  titles: readonly LeavingTitle[],
  runs: KeepRuns,
): LeavingEntry[] {
  const listed = new Set(titles.map((title) => title.rootMediaId));
  return [
    ...titles.map((current): LeavingEntry => {
      const run = runs.get(current.rootMediaId);
      return {
        rootMediaId: current.rootMediaId,
        current,
        run: run !== undefined && reports(run, current) ? run : null,
      };
    }),
    ...[...runs].flatMap(([rootMediaId, run]): LeavingEntry[] =>
      listed.has(rootMediaId) || !reports(run, null)
        ? []
        : [{ rootMediaId, current: null, run }],
    ),
  ];
}

/** The film or series an entry is about: as listed now, else as its run had it. */
export function entryTitle(entry: LeavingEntry): LeavingTitle {
  const title = entry.current ?? entry.run?.title;
  if (title === undefined) throw new Error("An entry with nothing to show");
  return title;
}

/**
 * The one row of an entry that is a single row with no report: it is just
 * that row and its own hold, not a set of parts.
 */
export function entrySingleRow(entry: LeavingEntry): LeavingRow | undefined {
  return entry.run === null && entry.current?.rows.length === 1
    ? entry.current.rows[0]
    : undefined;
}

/** Every row whose hold an entry's controls read. */
export function entryTargetIds(entries: readonly LeavingEntry[]): string[] {
  return entries.flatMap((entry) => [
    ...(entry.current?.rows ?? []).map((row) => row.removal.mediaId),
    // A row waiting for a retry keeps its view read, listed or not.
    ...(entry.run === null ? [] : unkeptRows(entry.run)).map(
      (row) => row.removal.mediaId,
    ),
  ]);
}

export type EntryRow = {
  row: LeavingRow;
  /** The row is in the removal list now, so it can still be kept. */
  listed: boolean;
  /** The row is one the run started with. */
  inRun: boolean;
};

/**
 * The rows an entry lists: the run's own rows in the order it started with,
 * then anything that has started leaving since.
 */
export function entryRows(entry: LeavingEntry): EntryRow[] {
  const current = entry.current?.rows ?? [];
  const listed = new Set(current.map((row) => row.removal.id));
  const ran = entry.run?.title.rows ?? [];
  const inRun = new Set(ran.map((row) => row.removal.id));
  return [
    ...ran.map((row) => ({
      row,
      listed: listed.has(row.removal.id),
      inRun: true,
    })),
    ...current
      .filter((row) => !inRun.has(row.removal.id))
      .map((row) => ({ row, listed: true, inRun: false })),
  ];
}
