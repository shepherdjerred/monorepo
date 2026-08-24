import { describe, expect, test } from "vitest";
import { ValidatedReportAiFinalDraftSchema } from "./report-query-final-schema.ts";

// A draft is validated against the language that will execute it, so this is
// v2 text rather than a preset from the legacy registry.
const VALID_QUERY =
  "SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants " +
  "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
  "GROUP BY player ORDER BY games DESC LIMIT 10 RENDER leaderboard";

function draft(queryText: string) {
  return {
    title: "Example",
    description: null,
    queryText,
    explanation: "Example report",
    warnings: [],
  };
}

describe("ValidatedReportAiFinalDraftSchema", () => {
  test("accepts a valid ScoutQL draft", () => {
    expect(ValidatedReportAiFinalDraftSchema.parse(draft(VALID_QUERY))).toEqual(
      draft(VALID_QUERY),
    );
  });

  test("turns invalid ScoutQL into a structured-output issue", () => {
    const result = ValidatedReportAiFinalDraftSchema.safeParse(
      draft("this is not ScoutQL"),
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid ScoutQL to fail");
    expect(result.error.issues[0]?.path).toEqual(["queryText"]);
    expect(result.error.issues[0]?.message).toContain(
      "ScoutQL validation failed",
    );
  });
});
