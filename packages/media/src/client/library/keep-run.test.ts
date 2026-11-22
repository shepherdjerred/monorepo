import { expect, test } from "vitest";
import { RemovalListSchema } from "#shared/api.ts";
import { keepSummary, type KeepOutcome } from "./keep-all.ts";
import {
  entryRows,
  leavingEntries,
  runDismissed,
  runFinished,
  runReported,
  runStarted,
  runSucceeded,
  unkeptRows,
  type KeepRuns,
} from "./keep-run.ts";
import { leavingTitles, type LeavingTitle } from "./removals.ts";

const SERIES = "00000002-0000-4000-8000-000000000001";

function episode(number: number, decision = number) {
  return {
    id: `0000000c-0000-4000-8000-00000000000${String(decision)}`,
    mediaId: `00000004-0000-4000-8000-00000000000${String(number)}`,
    rootMediaId: SERIES,
    rootTitle: "The Expanse",
    artwork: { posterPath: null, backdropPath: null },
    state: "grace_period",
    graceUntil: `2026-11-2${String(number)}T12:00:00.000Z`,
    purgeAfter: null,
    media: { title: `Episode ${String(number)}`, kind: "episode", version: 1 },
  };
}

/** The series as the removal list has it when it holds these episodes. */
function listing(...episodes: ReturnType<typeof episode>[]): LeavingTitle[] {
  return leavingTitles(RemovalListSchema.parse(episodes));
}

function expanse(...episodes: ReturnType<typeof episode>[]): LeavingTitle {
  const [title] = listing(...episodes);
  if (title === undefined) throw new Error("No leaving title");
  return title;
}

const FOUR = [1, 2, 3, 4].map((number) => episode(number));
const KEPT: KeepOutcome = { status: "kept" };
const FAILED: KeepOutcome = {
  status: "failed",
  error: new Error("Try again later."),
  submission: null,
};

/** A finished run of all four episodes with these results, in order. */
function ran(outcomes: readonly KeepOutcome[]): KeepRuns {
  const title = expanse(...FOUR);
  let runs = runStarted(new Map(), title);
  for (const [index, outcome] of outcomes.entries()) {
    const mediaId = title.rows[index]?.removal.mediaId;
    if (mediaId === undefined) throw new Error("No such row");
    runs = runReported(runs, SERIES, { mediaId, outcome });
  }
  return runFinished(runs, SERIES);
}

test("a report counts the rows the run started with after the list drops the kept ones", () => {
  const runs = ran([KEPT, FAILED, KEPT, KEPT]);
  const run = runs.get(SERIES);
  if (run === undefined) throw new Error("No run");

  // The list is read again: only the episode that failed is still leaving.
  const [entry] = leavingEntries(listing(episode(2)), runs);
  expect(entry?.current?.rows).toHaveLength(1);
  expect(entry?.run).toBe(run);
  expect(keepSummary(run.outcomes, run.title.rows.length, "episodes")).toBe(
    "Kept 3 of 4 episodes for 30 days. 1 could not be kept and is marked below.",
  );
  // All four are still listed in the report, each with what happened to it.
  const rows = entry === undefined ? [] : entryRows(entry);
  expect(
    rows.map(({ row, listed, inRun }) => [
      row.removal.media.title,
      run.outcomes.get(row.removal.mediaId)?.status,
      listed,
      inRun,
    ]),
  ).toEqual([
    ["Episode 1", "kept", false, true],
    ["Episode 2", "failed", true, true],
    ["Episode 3", "kept", false, true],
    ["Episode 4", "kept", false, true],
  ]);
  // And the retry is of exactly what failed.
  expect(unkeptRows(run).map((row) => row.removal.media.title)).toEqual([
    "Episode 2",
  ]);
});

test("a report with a failure outlives its title leaving the list, until it is dismissed", () => {
  const runs = ran([KEPT, FAILED, KEPT, KEPT]);
  const gone = leavingEntries([], runs);
  expect(gone).toHaveLength(1);
  expect(gone[0]).toMatchObject({ rootMediaId: SERIES, current: null });
  expect(gone[0]?.run?.title.name).toBe("The Expanse");

  const dismissed = runDismissed(runs, SERIES);
  expect(leavingEntries([], dismissed)).toEqual([]);
  // Dismissed with one episode still leaving: that episode, and no report.
  const [left] = leavingEntries(listing(episode(2)), dismissed);
  expect(left?.run).toBeNull();
  expect(left === undefined ? [] : entryRows(left)).toHaveLength(1);
});

test("a run that kept everything reports until the list catches up, and no longer", () => {
  const runs = ran([KEPT, KEPT, KEPT, KEPT]);
  const run = runs.get(SERIES);
  if (run === undefined) throw new Error("No run");
  expect(runSucceeded(run)).toBe(true);
  expect(unkeptRows(run)).toEqual([]);

  // Before the list is read again the rows are still there, with the report.
  expect(leavingEntries(listing(...FOUR), runs)[0]?.run).toBe(run);
  // Once they are gone, so is the entry.
  expect(leavingEntries([], runs)).toEqual([]);

  // A later removal of the same series is a new matter: different decisions,
  // no inherited report, and a fresh run.
  const later = listing(episode(1, 7), episode(2, 8));
  expect(leavingEntries(later, runs)[0]?.run).toBeNull();
  const [again] = later;
  if (again === undefined) throw new Error("No leaving title");
  const restarted = runStarted(runs, again).get(SERIES);
  expect(restarted?.title.rows).toHaveLength(2);
  expect(restarted?.outcomes.size).toBe(0);
  expect(restarted?.running).toBe(true);
});

test("trying again continues the same run with the results it already has", () => {
  const runs = ran([KEPT, FAILED, KEPT, KEPT]);
  // The retry starts from the list as it is now, one episode long.
  const retry = runStarted(runs, expanse(episode(2))).get(SERIES);
  expect(retry?.running).toBe(true);
  expect(retry?.title.rows).toHaveLength(4);
  expect(retry?.outcomes.size).toBe(4);
  // While it runs there is no summary to dismiss, and it has not succeeded.
  expect(retry === undefined ? null : runSucceeded(retry)).toBe(false);
});

test("a row that started leaving after the run is listed after the run's rows", () => {
  const runs = ran([KEPT, FAILED, KEPT, KEPT]);
  const [entry] = leavingEntries(listing(episode(2), episode(5)), runs);
  const rows = entry === undefined ? [] : entryRows(entry);
  expect(rows.map(({ row }) => row.removal.media.title)).toEqual([
    "Episode 1",
    "Episode 2",
    "Episode 3",
    "Episode 4",
    "Episode 5",
  ]);
  expect(rows.at(-1)).toMatchObject({ listed: true, inRun: false });
});
