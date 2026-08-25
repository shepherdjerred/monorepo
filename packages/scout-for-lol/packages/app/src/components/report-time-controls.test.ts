import { describe, expect, test } from "vitest";
import { applyReportTimeSpec } from "@scout-for-lol/data/model/scoutql/report-time-spec.ts";
import {
  compareAvailable,
  parseBucketChoice,
  parsePeriodChoice,
  periodChoice,
  timeControlsState,
  timezoneApplies,
  withBucket,
  withCalendarBoundary,
  withPeriod,
  withTimezone,
} from "#src/components/report-time-controls.tsx";

// ── Report time controls ─────────────────────────────────────────────────────
// The controls' entire job is to change ONE facet of a query and leave every
// other character where it was, so the round-trip assertions below are the
// point of this file: a control that reflows the query is a control that
// silently rewrites work the user did in the editor.

const WEEKLY = `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
WHERE queue IN ('solo')
  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = games)`;

function readySpec(queryText: string) {
  const state = timeControlsState(queryText);
  if (state.kind !== "ready") {
    throw new Error(`Expected ready controls, got: ${state.reason}`);
  }
  return state.spec;
}

/** What the controls would write back after one facet change. */
function apply(
  queryText: string,
  change: (spec: ReturnType<typeof readySpec>) => ReturnType<typeof readySpec>,
): string {
  return applyReportTimeSpec(queryText, change(readySpec(queryText)));
}

describe("which queries the controls apply to", () => {
  test("a bounded, bucketed query is ready", () => {
    expect(readySpec(WEEKLY)).toEqual({
      window: { kind: "relative", days: 90 },
      bucket: "week",
      compare: false,
      timezone: "UTC",
    });
  });

  test("a query with errors disables the controls and says so", () => {
    const state = timeControlsState(
      "SELECT AVG(win) AS win_rate FROM match_participants",
    );
    expect(state).toEqual({
      kind: "disabled",
      reason:
        "The query has errors. Fix them in the editor and these controls come back.",
    });
  });

  test("a snapshot source disables the controls", () => {
    const state = timeControlsState(
      "SELECT MAX(score) AS best FROM rank_current",
    );
    expect(state.kind).toBe("disabled");
    expect(state.kind === "disabled" ? state.reason : "").toContain(
      "point-in-time snapshot",
    );
  });

  test("a hand-written time filter disables the controls", () => {
    const state = timeControlsState(
      `SELECT COUNT(*) AS games
FROM match_participants
WHERE game_creation_at > '2026-01-01'
GROUP BY player`,
    );
    expect(state.kind).toBe("disabled");
    expect(state.kind === "disabled" ? state.reason : "").toContain(
      "hand-written",
    );
  });
});

describe("one facet at a time", () => {
  test("opening the controls rewrites nothing", () => {
    expect(apply(WEEKLY, (spec) => spec)).toBe(WEEKLY);
  });

  test("changing the period leaves every other clause byte for byte", () => {
    const next = apply(WEEKLY, (spec) =>
      withPeriod(spec, { kind: "relative", days: 30 }),
    );
    expect(next).toBe(WEEKLY.replace("INTERVAL 90 DAY", "INTERVAL 30 DAY"));
    expect(readySpec(next).bucket).toBe("week");
    expect(next).toContain("WHERE queue IN ('solo')");
  });

  test("all history removes the bound and nothing else", () => {
    const next = apply(WEEKLY, (spec) =>
      withPeriod(spec, { kind: "all-history" }),
    );
    expect(next).toBe(
      WEEKLY.replace(
        "\n  AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY",
        "",
      ),
    );
    expect(readySpec(next).window).toEqual({ kind: "all-history" });
  });

  test("dropping the bucket keeps the window, the filter and the render", () => {
    const next = apply(WEEKLY, (spec) => ({ ...spec, bucket: null }));
    const spec = readySpec(next);
    expect(spec.bucket).toBeNull();
    expect(spec.window).toEqual({ kind: "relative", days: 90 });
    expect(next).toContain("WHERE queue IN ('solo')");
    expect(next).toContain("INTERVAL 90 DAY");
    expect(next).toContain("RENDER line_chart WITH (y = games)");
  });

  test("turning comparison on only touches the render options", () => {
    const next = apply(WEEKLY, (spec) => ({ ...spec, compare: true }));
    expect(next).toBe(
      WEEKLY.replace(
        "WITH (y = games)",
        "WITH (y = games, compare = previous_period)",
      ),
    );
    expect(readySpec(next).compare).toBe(true);
  });

  test("turning comparison off again restores the original text", () => {
    const on = apply(WEEKLY, (spec) => ({ ...spec, compare: true }));
    expect(apply(on, (spec) => ({ ...spec, compare: false }))).toBe(WEEKLY);
  });

  test("comparison is available exactly when the window is bounded and bucketed", () => {
    const spec = readySpec(WEEKLY);
    expect(compareAvailable(spec)).toBe(true);
    expect(compareAvailable(withPeriod(spec, { kind: "all-history" }))).toBe(
      false,
    );
    expect(compareAvailable(withBucket(spec, null))).toBe(false);
  });

  test("switching to all history atomically turns comparison off, not into invalid ScoutQL", () => {
    const on = apply(WEEKLY, (spec) => ({ ...spec, compare: true }));
    const next = apply(on, (spec) => withPeriod(spec, { kind: "all-history" }));
    expect(readySpec(next).compare).toBe(false);
    expect(next).not.toContain("compare = previous_period");
  });

  test("dropping the bucket atomically turns comparison off too", () => {
    const on = apply(WEEKLY, (spec) => ({ ...spec, compare: true }));
    const next = apply(on, (spec) => withBucket(spec, null));
    expect(readySpec(next).compare).toBe(false);
    expect(next).not.toContain("compare = previous_period");
  });

  test("the time zone moves only the bucket boundaries", () => {
    const next = apply(WEEKLY, (spec) =>
      withTimezone(spec, "America/Los_Angeles"),
    );
    expect(next).toBe(
      WEEKLY.replaceAll(
        "DATE_TRUNC('week', game_creation_at)",
        "DATE_TRUNC('week', game_creation_at AT TIME ZONE 'America/Los_Angeles')",
      ),
    );
    expect(readySpec(next).timezone).toBe("America/Los_Angeles");
  });
});

describe("period choices", () => {
  test("read and parse round-trip through the select's value", () => {
    for (const query of [
      WEEKLY,
      apply(WEEKLY, (spec) => withPeriod(spec, { kind: "all-history" })),
    ]) {
      const spec = readySpec(query);
      expect(withPeriod(spec, parsePeriodChoice(periodChoice(spec)))).toEqual(
        spec,
      );
    }
  });

  test("custom dates are seeded from the period being left", () => {
    const spec = readySpec(WEEKLY);
    const now = new Date("2026-03-31T12:00:00.000Z");
    expect(withPeriod(spec, { kind: "calendar" }, now).window).toEqual({
      kind: "calendar",
      start: "2026-01-01",
      end: "2026-03-31",
      timezone: "UTC",
    });
  });

  test("an unknown select value is a bug, not a silent default", () => {
    expect(() => parsePeriodChoice("last-tuesday")).toThrow();
    expect(() => parseBucketChoice("fortnight")).toThrow();
  });

  test("bucket choices map to the spec's own values", () => {
    expect(parseBucketChoice("none")).toBeNull();
    expect(parseBucketChoice("month")).toBe("month");
  });
});

describe("calendar periods", () => {
  const calendarQuery = `SELECT COUNT(*) AS games
FROM match_participants
WHERE (game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN '2026-01-01' AND '2026-01-31'
GROUP BY player`;

  test("are read with their zone", () => {
    expect(readySpec(calendarQuery)).toEqual({
      window: {
        kind: "calendar",
        start: "2026-01-01",
        end: "2026-01-31",
        timezone: "America/Los_Angeles",
      },
      bucket: null,
      compare: false,
      timezone: "America/Los_Angeles",
    });
  });

  test("push the opposite endpoint rather than inverting the range", () => {
    const spec = readySpec(calendarQuery);
    expect(withCalendarBoundary(spec, "start", "2026-02-10").window).toEqual({
      kind: "calendar",
      start: "2026-02-10",
      end: "2026-02-10",
      timezone: "America/Los_Angeles",
    });
    expect(withCalendarBoundary(spec, "end", "2025-12-01").window).toEqual({
      kind: "calendar",
      start: "2025-12-01",
      end: "2025-12-01",
      timezone: "America/Los_Angeles",
    });
  });

  test("moving one date leaves the rest of the query alone", () => {
    const next = apply(calendarQuery, (spec) =>
      withCalendarBoundary(spec, "end", "2026-02-15"),
    );
    expect(next).toBe(calendarQuery.replace("'2026-01-31'", "'2026-02-15'"));
  });

  test("a calendar boundary edit needs a calendar period", () => {
    expect(() =>
      withCalendarBoundary(readySpec(WEEKLY), "start", "2026-01-01"),
    ).toThrow();
  });
});

describe("when the time zone matters", () => {
  test("only for calendar dates and calendar buckets", () => {
    const weekly = readySpec(WEEKLY);
    expect(timezoneApplies(weekly)).toBe(true);
    expect(timezoneApplies({ ...weekly, bucket: null })).toBe(false);
    expect(timezoneApplies({ ...weekly, bucket: "patch" })).toBe(false);
    expect(
      timezoneApplies({
        ...weekly,
        bucket: null,
        window: {
          kind: "calendar",
          start: "2026-01-01",
          end: "2026-01-31",
          timezone: "UTC",
        },
      }),
    ).toBe(true);
  });
});
