import { describe, expect, test } from "vitest";
import { compileScoutQl } from "#src/model/scoutql/compile.ts";
import { formatScoutQl } from "#src/model/scoutql/format.ts";
import { lintScoutQl } from "#src/model/scoutql/lint.ts";
import {
  SCOUTQL_IDIOMS,
  scoutQlIdiomSnippets,
} from "#src/model/scoutql/scoutql-idioms.ts";

// ── Idioms ───────────────────────────────────────────────────────────────────
// These recipes are quoted verbatim to two AI prompts, the docs cookbook, and
// the completion list. A recipe that no longer compiles teaches every one of
// those surfaces something false, so each is executed here.

describe("every idiom compiles and lints clean", () => {
  for (const idiom of SCOUTQL_IDIOMS) {
    test(`${idiom.id} — ${idiom.title}`, () => {
      expect(
        lintScoutQl(idiom.query).filter(
          (diagnostic) => diagnostic.severity === "error",
        ),
      ).toEqual([]);
      expect(() => compileScoutQl(idiom.query)).not.toThrow();
    });
  }
});

describe("idiom hygiene", () => {
  test("the cookbook holds 12 recipes with unique ids", () => {
    expect(SCOUTQL_IDIOMS).toHaveLength(12);
    expect(new Set(SCOUTQL_IDIOMS.map((idiom) => idiom.id)).size).toBe(12);
  });

  test("every idiom states a time bound, since the field guide demands one", () => {
    for (const idiom of SCOUTQL_IDIOMS) {
      expect(lintScoutQl(idiom.query)).toEqual([]);
    }
  });

  test("each idiom query is canonically formatted", () => {
    for (const idiom of SCOUTQL_IDIOMS) {
      expect(formatScoutQl(idiom.query)).toBe(idiom.query);
    }
  });

  test("the headline shapes are all covered", () => {
    const queries = SCOUTQL_IDIOMS.map((idiom) => idiom.query).join("\n");
    for (const shape of [
      "AVG(win::INT)",
      "FILTER (WHERE",
      "QUANTILE_CONT(",
      "COUNT(DISTINCT",
      "per_minute(",
      "kda()",
      "CURRENT_TIMESTAMP - INTERVAL",
      "AT TIME ZONE",
      "DATE_TRUNC('week'",
      "compare = previous_period",
      "FLOOR(",
      "player('",
      "champion('",
      "RENDER box_plot",
      "RENDER histogram",
    ]) {
      expect(queries).toContain(shape);
    }
  });
});

describe("snippets", () => {
  test("snippet bodies are offered per clause", () => {
    expect(scoutQlIdiomSnippets("select").length).toBeGreaterThan(4);
    expect(scoutQlIdiomSnippets("where").length).toBeGreaterThan(2);
  });

  test("a snippet's placeholders are well-formed tabstops", () => {
    for (const idiom of SCOUTQL_IDIOMS) {
      const body = idiom.snippet?.body;
      if (body === undefined) {
        continue;
      }
      // Balanced `${…}` and at least one tabstop or a literal fragment.
      expect(body.split("${").length - 1).toBe(body.split("}").length - 1);
    }
  });

  test("a SELECT snippet with its placeholders filled in compiles", () => {
    const filled = "COUNT(*) FILTER (WHERE win) AS wins";
    expect(
      lintScoutQl(
        `SELECT ${filled} FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY player`,
      ),
    ).toEqual([]);
  });
});
