import { describe, expect, test } from "vitest";
import type { ScoutQlDiagnostic } from "@scout-for-lol/data/model/scoutql/diagnostics.ts";
import { lintScoutQl } from "@scout-for-lol/data/model/scoutql/lint.ts";
import { scoutQlFixesForMarker } from "#src/lib/scoutql-monaco-providers.ts";

// Monaco markers carry no payload slot, so a quick fix cannot ride along on
// the marker. These tests pin the identity the code-action provider uses to
// find its way from a marker back to the diagnostic that produced it.

const unknownColumn: ScoutQlDiagnostic = {
  code: "unknown-column",
  message: "Unknown column `kils`.",
  severity: "error",
  span: { start: 7, end: 11 },
  fixes: [
    {
      title: "Change to `kills`",
      edits: [{ start: 7, end: 11, newText: "kills" }],
    },
  ],
};

const sameSpanDifferentProblem: ScoutQlDiagnostic = {
  code: "column-not-grouped",
  message: "`kils` is neither aggregated nor grouped.",
  severity: "error",
  span: { start: 7, end: 11 },
  fixes: [
    {
      title: "Wrap in SUM()",
      edits: [
        { start: 7, end: 7, newText: "SUM(" },
        { start: 11, end: 11, newText: ")" },
      ],
    },
  ],
};

describe("scoutQlFixesForMarker", () => {
  test("returns the fixes of the diagnostic that produced the marker", () => {
    expect(
      scoutQlFixesForMarker([unknownColumn, sameSpanDifferentProblem], {
        startOffset: 7,
        endOffset: 11,
        message: unknownColumn.message,
      }),
    ).toEqual(unknownColumn.fixes);
  });

  test("distinguishes two diagnostics sharing one span by message", () => {
    expect(
      scoutQlFixesForMarker([unknownColumn, sameSpanDifferentProblem], {
        startOffset: 7,
        endOffset: 11,
        message: sameSpanDifferentProblem.message,
      }),
    ).toEqual(sameSpanDifferentProblem.fixes);
  });

  test("distinguishes one message repeated at two offsets", () => {
    const second: ScoutQlDiagnostic = {
      ...unknownColumn,
      span: { start: 20, end: 24 },
      fixes: [
        {
          title: "Change to `kills`",
          edits: [{ start: 20, end: 24, newText: "kills" }],
        },
      ],
    };
    expect(
      scoutQlFixesForMarker([unknownColumn, second], {
        startOffset: 20,
        endOffset: 24,
        message: unknownColumn.message,
      }),
    ).toEqual(second.fixes);
  });

  test("returns nothing when no diagnostic matches the marker", () => {
    expect(
      scoutQlFixesForMarker([unknownColumn], {
        startOffset: 0,
        endOffset: 6,
        message: unknownColumn.message,
      }),
    ).toEqual([]);
  });

  test("a diagnostic without fixes yields no code action", () => {
    expect(
      scoutQlFixesForMarker([{ ...unknownColumn, fixes: undefined }], {
        startOffset: 7,
        endOffset: 11,
        message: unknownColumn.message,
      }),
    ).toEqual([]);
  });

  test("recovers fixes from a real lint result", () => {
    const query =
      "SELECT AVG(win) AS win_rate FROM match_participants GROUP BY player";
    const diagnostics = lintScoutQl(query);
    const withFixes = diagnostics.find(
      (diagnostic) => (diagnostic.fixes ?? []).length > 0,
    );
    expect(withFixes).toBeDefined();
    if (withFixes === undefined) {
      return;
    }
    expect(
      scoutQlFixesForMarker(diagnostics, {
        startOffset: withFixes.span.start,
        endOffset: withFixes.span.end,
        message: withFixes.message,
      }),
    ).toEqual(withFixes.fixes);
  });
});
