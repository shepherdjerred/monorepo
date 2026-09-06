import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import { formatScoutQl } from "@scout-for-lol/data/model/scoutql/format.ts";
import { lintScoutQl } from "@scout-for-lol/data/model/scoutql/lint.ts";
import { SCOUTQL_PRESETS } from "@scout-for-lol/data/model/scoutql/presets.ts";
import {
  EMPTY_REPORT_STATE,
  STARTER_REPORT_QUERY,
} from "#src/components/reports/report-form-fields.tsx";

// ── The starter query ────────────────────────────────────────────────────────
// A fresh report form arrives pre-filled, so this text is the first ScoutQL
// most people ever read. It is deliberately the "Most games played" preset
// verbatim: one canonical answer to "what does a report look like", not a
// second one maintained here.

const ACTIVITY_LEADERS = SCOUTQL_PRESETS.find(
  (preset) => preset.id === "activity-leaders",
);

describe("starter report query", () => {
  test("is the default query for a fresh form", () => {
    expect(EMPTY_REPORT_STATE.queryText).toBe(STARTER_REPORT_QUERY);
  });

  test("is the activity-leaders preset, character for character", () => {
    expect(ACTIVITY_LEADERS?.query).toBe(STARTER_REPORT_QUERY);
  });

  test("lints clean — no errors and no unbounded-window warning", () => {
    expect(lintScoutQl(STARTER_REPORT_QUERY)).toEqual([]);
  });

  test("is already canonically formatted", () => {
    expect(formatScoutQl(STARTER_REPORT_QUERY)).toBe(STARTER_REPORT_QUERY);
  });

  test("compiles to a 30-day player leaderboard", () => {
    const plan = compileScoutQl(STARTER_REPORT_QUERY);
    expect(plan.source).toBe("match_participants");
    expect(plan.outputs.map((output) => output.name)).toEqual([
      "games",
      "win_rate",
    ]);
    expect(plan.groupings).toEqual([
      { kind: "column", column: "player", name: "player" },
    ]);
    expect(plan.timeWindow).toEqual({
      kind: "relative",
      amount: 30,
      unit: "day",
    });
    expect(plan.orderBy).toEqual([
      { target: { kind: "output", name: "games" }, direction: "desc" },
    ]);
    expect(plan.limit).toBe(10);
    expect(plan.render.kind).toBe("LEADERBOARD");
  });
});
