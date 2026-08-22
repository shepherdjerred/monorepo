import { describe, expect, test } from "vitest";
import {
  MIN_DRIFT_LOOKBACK_DAYS,
  proposeQueueWindowEdits,
} from "#src/model/queue-window-drift.ts";
import {
  QueueWindowsFileSchema,
  type QueueWindowsFile,
} from "#src/model/queue-windows.schema.ts";

const TODAY = "2026-07-26";
/** What the scheduled watcher and the CLI default to. */
const LOOKBACK = 28;

function makeFile(
  queues: Record<string, [start: string, end: string | null][]>,
): QueueWindowsFile {
  const shaped: Record<
    string,
    { start: string; end: string | null; source: "manual" }[]
  > = {};
  for (const [queue, windows] of Object.entries(queues)) {
    shaped[queue] = windows.map(([start, end]) => ({
      start,
      end,
      source: "manual",
    }));
  }
  return QueueWindowsFileSchema.parse({ queues: shaped });
}

function propose(
  file: QueueWindowsFile,
  counts: Record<string, Record<string, number>>,
) {
  return proposeQueueWindowEdits({
    file,
    counts,
    today: TODAY,
    lookbackDays: LOOKBACK,
  });
}

describe("proposeQueueWindowEdits", () => {
  test("opens a new window for a limited queue with fresh activity", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    const { edits, next } = propose(file, {
      "1900": { "2026-07-12": 2, "2026-07-14": 2 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("open");
    expect(edits[0]?.queue).toBe("urf");
    expect(edits[0]?.date).toBe("2026-07-12");
    const urfWindows = next.queues["urf"];
    expect(urfWindows?.at(-1)).toMatchObject({
      start: "2026-07-12",
      end: null,
      source: "observed",
    });
  });

  test("does not open below the distinct-days/match thresholds", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    const { edits, warnings } = propose(file, {
      "1900": { "2026-07-12": 1, "2026-07-14": 1 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("reopens a recently-closed window when new activity is within 7 days", () => {
    const file = makeFile({ urf: [["2026-07-01", "2026-07-10"]] });
    const { edits, next } = propose(file, {
      "1900": { "2026-07-12": 2, "2026-07-14": 2 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("reopen");
    const urfWindows = next.queues["urf"];
    const last = urfWindows?.at(-1);
    expect(last?.start).toBe("2026-07-01");
    expect(last?.end).toBeNull();
    expect(last?.note).toContain("reopened by watcher 2026-07-26");
  });

  test("does not reopen a closed window from its own pre-close (stale) volume", () => {
    // All observed matches fall on/before the window's close date, so they are
    // already covered by the just-closed window. A negative reopen gap must not
    // count as "within 7 days" and reopen the window on the next daily run.
    const file = makeFile({ urf: [["2026-07-01", "2026-07-10"]] });
    const { edits, warnings } = propose(file, {
      "1900": { "2026-07-05": 2, "2026-07-08": 2 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("does not close a fresh window from a prior run's pre-window volume", () => {
    // The open window started at 2026-07-14; the 20 matches on 2026-07-08 belong
    // to a previous window and must not satisfy the close baseline. Only the
    // single in-window match on 2026-07-15 counts, so this warns rather than
    // closing the new window off stale activity.
    const file = makeFile({ arena: [["2026-07-14", null]] });
    const { edits, warnings } = propose(file, {
      "1700": { "2026-07-08": 20, "2026-07-15": 1 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("no-volume-baseline");
    expect(warnings[0]?.total).toBe(1);
  });

  test("skips a future-announced window (start after today)", () => {
    // A window recorded ahead of its start with end:null is not yet active.
    // Even with pre-start observations (which would otherwise append an
    // out-of-order open window and fail schema validation), no drift is
    // proposed and no sparse warning is emitted until the start date arrives.
    const file = makeFile({ urf: [["2026-08-01", null]] });
    const { edits, warnings, next } = propose(file, {
      "1900": { "2026-07-10": 2, "2026-07-12": 2 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    // Unchanged — still the single future window.
    expect(next.queues["urf"]).toEqual(file.queues["urf"]);
  });

  test("throws when Doom Bots difficulties fall out of lockstep", () => {
    const file = makeFile({
      "easy doom bots": [["2025-08-27", "2025-10-22"]],
      "normal doom bots": [["2025-08-27", "2025-10-23"]],
      "hard doom bots": [["2025-08-27", "2025-10-22"]],
    });
    expect(() => propose(file, {})).toThrow(/lockstep/);
  });

  test("closes an open-ended window with a volume baseline and no recent matches", () => {
    const file = makeFile({ arena: [["2025-06-25", null]] });
    const { edits, next } = propose(file, {
      "1700": { "2026-07-06": 10, "2026-07-07": 10, "2026-07-08": 5 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("close");
    expect(edits[0]?.date).toBe("2026-07-08");
    const arenaWindows = next.queues["arena"];
    expect(arenaWindows?.at(-1)?.end).toBe("2026-07-08");
  });

  test("never auto-closes a sparse open-ended mode (no observations)", () => {
    const file = makeFile({ arena: [["2025-06-25", null]] });
    const { edits, warnings } = propose(file, {});
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("sparse-no-close");
  });

  test("warns without closing when the volume baseline is below threshold", () => {
    const file = makeFile({ arena: [["2025-06-25", null]] });
    const { edits, warnings } = propose(file, {
      "1700": { "2026-07-06": 5, "2026-07-07": 3 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("no-volume-baseline");
  });

  test("warns about unknown queue ids observed in the window", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    const { edits, warnings } = propose(file, {
      "999999": { "2026-07-10": 4 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "unknown-queue-id",
      queueId: "999999",
      total: 4,
    });
  });

  test("aggregates multiple queue ids for one mode (arena 1700 + 1750)", () => {
    const file = makeFile({ arena: [["2025-06-25", "2025-12-01"]] });
    const { edits } = propose(file, {
      "1700": { "2026-07-10": 2 },
      "1750": { "2026-07-14": 2 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("open");
    expect(edits[0]?.date).toBe("2026-07-10");
  });

  test("applies identical edits to the Doom Bots trio in lockstep", () => {
    const file = makeFile({
      "easy doom bots": [["2025-08-27", "2025-10-22"]],
      "normal doom bots": [["2025-08-27", "2025-10-22"]],
      "hard doom bots": [["2025-08-27", "2025-10-22"]],
    });
    const { edits, next } = propose(file, {
      "4220": { "2026-07-06": 2 },
      "4250": { "2026-07-07": 1 },
    });
    expect(edits).toHaveLength(3);
    expect(edits.every((edit) => edit.kind === "open")).toBe(true);
    expect(edits.every((edit) => edit.date === "2026-07-06")).toBe(true);
    const easy = next.queues["easy doom bots"];
    const normal = next.queues["normal doom bots"];
    const hard = next.queues["hard doom bots"];
    expect(easy).toEqual(normal);
    expect(normal).toEqual(hard);
    expect(easy?.at(-1)).toMatchObject({
      start: "2026-07-06",
      end: null,
      source: "observed",
    });
  });

  test("makes no changes in steady state (live modes keep flowing)", () => {
    const file = makeFile({
      arena: [["2025-06-25", null]],
      "aram mayhem": [["2025-10-22", null]],
      urf: [["2026-06-01", "2026-06-15"]],
    });
    const { edits, warnings } = propose(file, {
      "1700": { "2026-07-22": 5 },
      "2400": { "2026-07-23": 4 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("ignores permanent-queue observations entirely", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    // 420 = solo (permanent), 450 = aram (permanent) — must not appear anywhere.
    const { edits, warnings } = propose(file, {
      "420": { "2026-07-10": 50, "2026-07-11": 50 },
      "450": { "2026-07-10": 50 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

describe("proposeQueueWindowEdits close guards", () => {
  test("refuses to close a launch-week window even with a full volume baseline (PR #2100 replay)", () => {
    // The real false positive: `classic aram mayhem` opened 2026-07-29 — the
    // start of Ranked Season 3 — took 20+ matches over its first two days, then
    // went quiet. On 2026-08-10 the watcher proposed retiring it while ARAM:
    // Mayhem was still receiving balance changes in the current patch.
    //
    // Every pre-existing close condition is satisfied here: no trailing
    // matches, and earlierTotal (24) clears CLOSE_MIN_VOLUME_BASELINE. Only the
    // window's age stops it.
    const file = makeFile({ "classic aram mayhem": [["2026-07-29", null]] });
    const { edits, warnings, next } = proposeQueueWindowEdits({
      file,
      counts: { "2450": { "2026-07-29": 14, "2026-07-30": 10 } },
      today: "2026-08-10",
      lookbackDays: LOOKBACK,
    });

    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("window-too-young");
    expect(warnings[0]?.total).toBe(24);
    expect(warnings[0]?.message).toContain("12 day(s) old");
    // The window must remain open-ended, or the queue disappears from the
    // subscription picker.
    expect(next.queues["classic aram mayhem"]?.at(-1)?.end).toBeNull();
  });

  test("closes once the window clears the minimum age with the same evidence shape", () => {
    // Identical evidence to the replay above, just an older window: a burst at
    // the start, then nothing. At 30 days old the close is trusted.
    const file = makeFile({ "classic aram mayhem": [["2026-07-11", null]] });
    const { edits, warnings } = proposeQueueWindowEdits({
      file,
      counts: { "2450": { "2026-07-24": 14, "2026-07-25": 10 } },
      today: "2026-08-10",
      lookbackDays: LOOKBACK,
    });

    expect(warnings).toHaveLength(0);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("close");
    expect(edits[0]?.date).toBe("2026-07-25");
  });

  test("stays silent about a young window that is still being played", () => {
    // The age gate must not turn every fresh mode into a daily warning email —
    // it only speaks once the mode has actually gone quiet.
    const file = makeFile({ "classic aram mayhem": [["2026-07-29", null]] });
    const { edits, warnings } = proposeQueueWindowEdits({
      file,
      counts: { "2450": { "2026-08-08": 3, "2026-08-09": 4 } },
      today: "2026-08-10",
      lookbackDays: LOOKBACK,
    });

    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

function addDaysUtc(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe("proposeQueueWindowEdits close eligibility span", () => {
  const WINDOW_START = "2026-07-01";

  /** Outcome of the daily run that sees `WINDOW_START` as `age` days ago. */
  function runAtAge(age: number) {
    return proposeQueueWindowEdits({
      file: makeFile({ "classic aram mayhem": [[WINDOW_START, null]] }),
      // Worst case for eligibility: the entire volume baseline lands on the
      // window's first day, so it is the first evidence to fall out of the
      // lookback. This is the launch-burst shape the age gate exists for.
      counts: { "2450": { [WINDOW_START]: 24 } },
      today: addDaysUtc(WINDOW_START, age),
      lookbackDays: LOOKBACK,
    });
  }

  test("re-proposes the same close on every run of a week-long review window", () => {
    // The close is not applied automatically — it opens a PR, and the watcher
    // closes that PR as soon as a run produces no drift. So the close has to be
    // re-derivable across enough consecutive runs for a human to review it. With
    // lookbackDays equal to the minimum age this band was a single day: the next
    // morning the burst aged out of the lookback, the baseline collapsed, and
    // the unreviewed proposal was closed for good.
    const closingAges: number[] = [];
    for (let age = 1; age <= 40; age++) {
      const { edits } = runAtAge(age);
      if (edits.some((edit) => edit.kind === "close")) {
        closingAges.push(age);
      }
    }

    expect(closingAges).toEqual([21, 22, 23, 24, 25, 26, 27, 28]);
    expect(closingAges.length).toBeGreaterThanOrEqual(7);
  });

  test("withholds the close below the minimum age and loses the baseline past the lookback", () => {
    // The two ends of the band above, and how each is reported: too young while
    // the evidence is still visible, then no evidence at all once the burst has
    // fallen outside the lookback.
    const tooYoung = runAtAge(20);
    expect(tooYoung.edits).toHaveLength(0);
    expect(tooYoung.warnings[0]?.kind).toBe("window-too-young");
    expect(tooYoung.warnings[0]?.total).toBe(24);

    const agedOut = runAtAge(29);
    expect(agedOut.edits).toHaveLength(0);
    expect(agedOut.warnings[0]?.kind).toBe("sparse-no-close");
  });

  test("rejects a lookback that collapses close eligibility to a single run", () => {
    expect(() =>
      proposeQueueWindowEdits({
        file: makeFile({ "classic aram mayhem": [[WINDOW_START, null]] }),
        counts: {},
        today: TODAY,
        lookbackDays: MIN_DRIFT_LOOKBACK_DAYS - 1,
      }),
    ).toThrow(/lookbackDays must be at least/);
  });
});
