import { describe, expect, test } from "vitest";
import { lintScoutQl, scoutQlIsValid } from "#src/model/scoutql/lint.ts";
import { SCOUTQL_PRESETS } from "#src/model/scoutql/presets.ts";

// ── Lint ─────────────────────────────────────────────────────────────────────
// `lintScoutQl` is one call over the single analysis pass, so what is worth
// asserting is the editor-facing contract: never throws, sorted by position,
// severities mean what the compiler means by them, and fixes travel with the
// diagnostic that earned them.

const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

describe("editor contract", () => {
  test("a clean query lints silently", () => {
    expect(
      lintScoutQl(
        `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player`,
      ),
    ).toEqual([]);
  });

  test("an unbounded query warns without blocking, and offers the fix", () => {
    const [diagnostic, ...rest] = lintScoutQl(
      "SELECT COUNT(*) AS games FROM match_participants GROUP BY player",
    );
    expect(rest).toEqual([]);
    expect(diagnostic?.code).toBe("time-window-unbounded");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.fixes?.[0]?.edits[0]?.newText).toContain(
      "INTERVAL 30 DAY",
    );
    expect(
      scoutQlIsValid("SELECT COUNT(*) AS games FROM match_participants"),
    ).toBe(true);
  });

  test("errors carry codes and spans, in source order", () => {
    const diagnostics = lintScoutQl(
      "SELECT AVG(win) AS r, nonsense AS n FROM match_participants GROUP BY player",
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "aggregate-over-boolean",
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unknown-column",
    );
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(scoutQlIsValid("SELECT AVG(win) AS r FROM match_participants")).toBe(
      false,
    );
  });

  test.each([
    "",
    "   ",
    "SELECT",
    "SELECT COUNT(*",
    "))) FROM",
    "-- only a comment",
    "SELECT COUNT(*) AS g FROM match_participants WHERE '",
  ])("never throws on %s", (query) => {
    expect(() => lintScoutQl(query)).not.toThrow();
  });

  test("every preset is valid by the same check the compiler uses", () => {
    for (const preset of SCOUTQL_PRESETS) {
      expect(scoutQlIsValid(preset.query)).toBe(true);
    }
  });
});
