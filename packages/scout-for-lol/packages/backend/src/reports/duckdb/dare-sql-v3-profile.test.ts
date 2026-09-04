import { describe, expect, test } from "vitest";
import { appendDareSqlV3DeterminismIssues } from "#src/reports/duckdb/dare-sql-v3-profile.ts";

describe("Dare SQL v3 determinism profile", () => {
  test("rejects row_number windows whose ordering cannot be proven", () => {
    const issues: string[] = [];
    appendDareSqlV3DeterminismIssues(
      { type: "FUNCTION", function_name: "row_number" },
      issues,
    );
    expect(issues).toContain(
      "Dare SQL row_number is not permitted because its window ordering cannot be proven deterministic.",
    );
  });
});
