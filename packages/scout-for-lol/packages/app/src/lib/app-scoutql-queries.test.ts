import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import { lintScoutQl } from "@scout-for-lol/data/model/scoutql/lint.ts";
import { SCOUTQL_IDIOMS } from "@scout-for-lol/data/model/scoutql/scoutql-idioms.ts";
import { SCOUTQL_PRESETS } from "@scout-for-lol/data/model/scoutql/presets.ts";
import { REPORT_EXAMPLES } from "#src/lib/onboarding/onboarding-examples.ts";
import { STARTER_REPORT_QUERY } from "#src/components/reports/report-form-fields.tsx";
import {
  SCOUTQL_SHAPE_EXAMPLE,
  scoutQlClauseSummary,
} from "#src/lib/scoutql/scoutql-clause-summary.ts";
import {
  scoutQlFunctionSections,
  scoutQlKeywordList,
  scoutQlQueueItems,
  scoutQlRenderKindItems,
  scoutQlRenderOptionNames,
  scoutQlSourceSections,
  scoutQlTimeBoundItems,
} from "#src/lib/reports/report-query-docs-sections.ts";

// ── Every ScoutQL string this app shows ──────────────────────────────────────
// The app puts query text in front of people in four places: the starter form,
// the onboarding presets, the preset picker, and the reference's recipes and
// shape example. A query that does not compile is worse than no query — it
// lands in the editor as a broken one the reader did not write — so all four
// are compiled here rather than trusted.

function errorsIn(query: string): unknown[] {
  return lintScoutQl(query).filter(
    (diagnostic) => diagnostic.severity === "error",
  );
}

function expectRunnable(query: string): void {
  expect(errorsIn(query)).toEqual([]);
  expect(() => compileScoutQl(query)).not.toThrow();
}

describe("queries the app authors", () => {
  test("the starter query runs", () => {
    expectRunnable(STARTER_REPORT_QUERY);
  });

  test("all three onboarding examples run", () => {
    expect(REPORT_EXAMPLES).toHaveLength(3);
    for (const example of REPORT_EXAMPLES) {
      expectRunnable(example.build("123456789").queryText);
    }
  });

  test("onboarding examples state a time bound", () => {
    for (const example of REPORT_EXAMPLES) {
      expect(lintScoutQl(example.build("1").queryText)).toEqual([]);
    }
  });

  test("the reference's shape example runs and uses every clause", () => {
    expectRunnable(SCOUTQL_SHAPE_EXAMPLE);
    const clauses = scoutQlClauseSummary();
    expect(clauses.map((clause) => clause.keyword)).toEqual([
      "SELECT",
      "FROM",
      "WHERE",
      "GROUP BY",
      "HAVING",
      "ORDER BY",
      "LIMIT",
      "RENDER",
    ]);
  });
});

describe("queries the app renders from the language registries", () => {
  test("every preset the picker offers runs", () => {
    expect(SCOUTQL_PRESETS.length).toBeGreaterThan(0);
    for (const preset of SCOUTQL_PRESETS) {
      expectRunnable(preset.query);
    }
  });

  test("every recipe the reference shows runs", () => {
    expect(SCOUTQL_IDIOMS.length).toBeGreaterThan(0);
    for (const idiom of SCOUTQL_IDIOMS) {
      expectRunnable(idiom.query);
    }
  });
});

describe("the reference is built, not written", () => {
  test("every source is listed with its columns and time note", () => {
    const sources = scoutQlSourceSections();
    expect(sources.map((source) => source.id)).toContain("match_participants");
    const snapshot = sources.find((source) => source.id === "rank_current");
    expect(snapshot?.timeNote).toContain("no time bound");
    for (const source of sources) {
      expect(source.columns.length).toBeGreaterThan(0);
    }
  });

  test("functions are grouped by kind and none is dropped", () => {
    const sections = scoutQlFunctionSections();
    expect(sections.map((section) => section.title)).toEqual([
      "Aggregate functions",
      "Scalar functions",
      "Scout macros",
      "References",
    ]);
    const listed = sections.flatMap((section) => section.items);
    expect(listed.length).toBeGreaterThanOrEqual(20);
    expect(sections[0]?.items.map((item) => item.term)).toContain(
      "COUNT(*) · COUNT(x) · COUNT(DISTINCT x)",
    );
  });

  test("render kinds include the two the v2 renderer added", () => {
    const terms = scoutQlRenderKindItems().map((item) => item.term);
    expect(terms).toContain("histogram");
    expect(terms).toContain("box_plot");
  });

  test("the option list and keyword list come from the grammar", () => {
    expect(scoutQlRenderOptionNames()).toContain("compare");
    const keywords = scoutQlKeywordList();
    expect(keywords).toContain("SELECT");
    expect(keywords).toContain("RENDER");
    // The clauses the v2 grammar removed must not reappear in the reference.
    expect(keywords).not.toContain("DURING");
    expect(keywords).not.toContain("ANALYZE");
    expect(keywords).not.toContain("BUCKET");
  });

  test("time bounds lead with the omission rule", () => {
    const items = scoutQlTimeBoundItems();
    expect(items[0]?.term).toBe("(no time filter)");
    expect(items[0]?.description).toContain("ever ingested");
  });

  test("queue values are quoted as the literals a filter needs", () => {
    expect(scoutQlQueueItems().map((item) => item.term)).toContain("'solo'");
  });
});
