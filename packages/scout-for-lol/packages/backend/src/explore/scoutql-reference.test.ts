import { describe, expect, test } from "vitest";
import { exploreScoutQlReference } from "#src/explore/scoutql-reference.ts";
import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

describe("exploreScoutQlReference", () => {
  const text = exploreScoutQlReference();
  const reference = scoutQlLanguageReference();
  const banned = new Set([
    "competition_match_participants",
    "competition_rank",
    "rank_current",
  ]);

  test("names every source Explore may query, and every one of its columns", () => {
    // Compact, but never lossy: a column missing here is a column the model
    // cannot know exists.
    for (const source of reference.sources) {
      if (banned.has(source.id)) continue;
      expect(text).toContain(`### ${source.id} `);
      for (const column of source.columns) {
        expect(text).toMatch(new RegExp(String.raw`\b${column.name}\b`, "u"));
      }
    }
  });

  test("leaves out the sources Explore may never query", () => {
    for (const id of banned) expect(text).not.toContain(`### ${id} `);
  });

  test("names every function and render kind", () => {
    for (const fn of [
      ...reference.aggregateFunctions,
      ...reference.scalarFunctions,
      ...reference.macroFunctions,
      ...reference.referenceFunctions,
    ]) {
      expect(text).toContain(fn.signatures[0] ?? fn.name);
    }
    for (const kind of reference.renderKinds) expect(text).toContain(kind.id);
  });

  test("is a fraction of the JSON catalog it is generated from", () => {
    expect(text.length).toBeLessThan(JSON.stringify(reference).length / 3);
  });
});
