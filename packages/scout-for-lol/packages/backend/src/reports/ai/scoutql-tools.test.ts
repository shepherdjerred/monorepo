import { describe, expect, test } from "vitest";
import { SCOUTQL_IDIOMS } from "@scout-for-lol/data/model/scoutql/scoutql-idioms.ts";
import { SCOUTQL_PRESETS } from "@scout-for-lol/data/model/scoutql/presets.ts";
import {
  LanguageToolOutputSchema,
  scoutQlLanguageReference,
  validateQuery,
} from "#src/reports/ai/scoutql-tools.ts";

describe("scoutQlLanguageReference", () => {
  test("matches the tool's declared output contract", () => {
    expect(() =>
      LanguageToolOutputSchema.parse(scoutQlLanguageReference()),
    ).not.toThrow();
  });

  test("carries every source's columns and its time column", () => {
    const reference = scoutQlLanguageReference();
    const matchParticipants = reference.sources.find(
      (source) => source.id === "match_participants",
    );
    if (matchParticipants === undefined) {
      throw new Error("match_participants is missing from the reference");
    }
    expect(matchParticipants.timeColumn).toBe("game_creation_at");
    expect(matchParticipants.columns.map((column) => column.name)).toContain(
      "win",
    );

    // Rank snapshots are point-in-time and have no history to bound, which the
    // model has to be told or it invents a timestamp column.
    const rankCurrent = reference.sources.find(
      (source) => source.id === "rank_current",
    );
    expect(rankCurrent?.timeColumn).toBeNull();
  });

  test("carries the functions the field guide's rules depend on", () => {
    const reference = scoutQlLanguageReference();
    expect(reference.aggregateFunctions.map((fn) => fn.name)).toContain("avg");
    expect(reference.scalarFunctions.map((fn) => fn.name)).toContain(
      "date_trunc",
    );
    expect(reference.macroFunctions.map((fn) => fn.name)).toContain(
      "per_minute",
    );
    expect(reference.referenceFunctions.map((fn) => fn.name)).toContain(
      "player",
    );
  });

  test("offers the v2 render kinds, including the new distribution charts", () => {
    const kinds = scoutQlLanguageReference().renderKinds;
    expect(kinds.map((kind) => kind.id)).toEqual(
      expect.arrayContaining(["histogram", "box_plot", "leaderboard"]),
    );
    expect(kinds.find((kind) => kind.id === "leaderboard")?.isChart).toBe(
      false,
    );
    expect(kinds.find((kind) => kind.id === "histogram")?.isChart).toBe(true);
    expect(scoutQlLanguageReference().renderOptions).toContain("compare");
  });
});

describe("validateQuery", () => {
  // Everything the language ships as an example: what the model is shown in
  // the field guide, and what a user can insert from the preset picker. Either
  // one failing to validate means the agent is being taught a query it cannot
  // run.
  const SHIPPED_QUERIES: readonly (readonly [string, string])[] = [
    ...SCOUTQL_IDIOMS.map(
      (idiom) => [`idiom ${idiom.id}`, idiom.query] as const,
    ),
    ...SCOUTQL_PRESETS.map(
      (preset) => [`preset ${preset.id}`, preset.query] as const,
    ),
  ];

  test.each(SHIPPED_QUERIES)("accepts the %s", (_label, query) => {
    const result = validateQuery(query);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    expect(result.ok).toBe(true);
    expect(result.formattedQueryText).not.toBeNull();
  });

  test("rejects legacy v1 syntax with coded, spanned diagnostics", () => {
    const legacy =
      "SELECT games, win_rate FROM match_participants GROUP BY player DURING LAST 30 DAYS";

    // It must be a tool result, not a throw: the agent repairs from these.
    const result = validateQuery(legacy);

    expect(result.ok).toBe(false);
    expect(result.formattedQueryText).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    for (const diagnostic of errors) {
      expect(diagnostic.code.length).toBeGreaterThan(0);
      expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
      expect(diagnostic.span.end).toBeLessThanOrEqual(legacy.length);
    }
    expect(result.message).toBe(errors[0]?.message);
  });

  test("reports an unbounded query as valid, and says so", () => {
    const unbounded =
      "SELECT COUNT(*) AS games FROM match_participants GROUP BY player ORDER BY games DESC LIMIT 10";

    const result = validateQuery(unbounded);

    // Omitting a time bound is legal and means all ingested history. The model
    // only learns it wrote one if the advisory comes back with the success.
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain(
      "time-window-unbounded",
    );
    expect(result.message).toContain("Query is valid.");
  });
});
