import { describe, expect, test } from "vitest";
import { SCOUTQL_IDIOMS } from "@scout-for-lol/data/model/scoutql/scoutql-idioms.ts";
import { scoutQlFieldGuideSection } from "#src/reports/ai/scoutql-field-guide.ts";
import { validateQuery } from "#src/reports/ai/scoutql-tools.ts";

/** Every fenced ScoutQL block in the guide, in order. */
function fencedQueries(section: string): string[] {
  return [...section.matchAll(/```scoutql\n([\s\S]*?)\n```/g)].map(
    (fence) => fence[1] ?? "",
  );
}

describe("scoutQlFieldGuideSection", () => {
  test("states every hard rule the language needs a model to follow", () => {
    const guide = scoutQlFieldGuideSection();

    // Each rule, by the phrase that carries it. A rule quietly dropped from
    // the guide is the failure mode this asserts against.
    for (const phrase of [
      "State a time bound",
      "all ingested history",
      "`AVG(win::INT)`, never `AVG(win)`",
      "Aggregate explicitly",
      "player('…')",
      "champion('Jinx')",
      "HAVING COUNT(*) >= 10",
      "DATE_TRUNC('week', game_creation_at)",
      "compare = previous_period",
      "FILTER (WHERE …)",
    ]) {
      expect(guide).toContain(phrase);
    }
  });

  test("interpolates the shared idioms rather than restating them", () => {
    const guide = scoutQlFieldGuideSection();
    expect(fencedQueries(guide)).toEqual(
      SCOUTQL_IDIOMS.map((idiom) => idiom.query),
    );
    for (const idiom of SCOUTQL_IDIOMS) {
      expect(guide).toContain(idiom.title);
      expect(guide).toContain(idiom.description);
    }
  });

  test("every example query in the guide compiles", () => {
    // Cheap insurance: a prompt example that no longer parses is text a model
    // copies faithfully into a query that cannot run.
    for (const query of fencedQueries(scoutQlFieldGuideSection())) {
      const result = validateQuery(query);
      expect({
        query,
        errors: result.diagnostics.filter((d) => d.severity === "error"),
      }).toEqual({ query, errors: [] });
    }
  });
});
