import { describe, expect, test } from "vitest";
import { compileScoutQl } from "#src/model/scoutql/compile.ts";
import { formatScoutQl } from "#src/model/scoutql/format.ts";
import { lintScoutQl } from "#src/model/scoutql/lint.ts";
import {
  SCOUTQL_PRESETS,
  SCOUTQL_PRESET_EXAMPLES,
} from "#src/model/scoutql/presets.ts";

// ── Presets ──────────────────────────────────────────────────────────────────
// A preset that does not compile is worse than no preset: it lands in the
// editor as a broken query the user did not write. Every one is therefore
// compiled here, and pinned to a count so a rewrite cannot quietly drop one.

describe("every preset is a working query", () => {
  for (const preset of SCOUTQL_PRESETS) {
    test(`${preset.id} — ${preset.title}`, () => {
      expect(
        lintScoutQl(preset.query).filter(
          (diagnostic) => diagnostic.severity === "error",
        ),
      ).toEqual([]);
      expect(() => compileScoutQl(preset.query)).not.toThrow();
    });
  }
});

describe("preset hygiene", () => {
  test("the catalogue holds 25 presets", () => {
    expect(SCOUTQL_PRESETS).toHaveLength(25);
  });

  test("ids and titles are unique", () => {
    expect(new Set(SCOUTQL_PRESETS.map((preset) => preset.id)).size).toBe(25);
    expect(new Set(SCOUTQL_PRESETS.map((preset) => preset.title)).size).toBe(
      25,
    );
  });

  test("every preset states a time bound (no unbounded warnings)", () => {
    for (const preset of SCOUTQL_PRESETS) {
      expect(lintScoutQl(preset.query)).toEqual([]);
    }
  });

  test("each preset is already canonically formatted", () => {
    for (const preset of SCOUTQL_PRESETS) {
      expect(formatScoutQl(preset.query)).toBe(preset.query);
    }
  });

  test("the two new render kinds are exercised", () => {
    const kinds = SCOUTQL_PRESETS.map(
      (preset) => compileScoutQl(preset.query).render.kind,
    );
    expect(kinds).toContain("HISTOGRAM");
    const comparing = SCOUTQL_PRESETS.filter((preset) =>
      preset.query.includes("compare = previous_period"),
    );
    expect(comparing.length).toBeGreaterThanOrEqual(2);
  });

  test("examples mirror the presets", () => {
    expect(SCOUTQL_PRESET_EXAMPLES).toHaveLength(SCOUTQL_PRESETS.length);
    expect(SCOUTQL_PRESET_EXAMPLES[0]?.query).toBe(SCOUTQL_PRESETS[0]?.query);
  });
});
