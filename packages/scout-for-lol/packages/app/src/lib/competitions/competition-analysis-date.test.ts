import { describe, expect, test } from "vitest";
import { competitionAnalysisDateInput } from "#src/lib/competitions/competition-analysis-date.ts";

describe("competitionAnalysisDateInput", () => {
  test("formats competition bounds in the configured analysis timezone", () => {
    const start = "2026-08-08T00:00:00.000Z";

    expect(competitionAnalysisDateInput(start, "UTC")).toBe("2026-08-08");
    expect(competitionAnalysisDateInput(start, "America/Los_Angeles")).toBe(
      "2026-08-07",
    );
  });

  test("preserves an unset competition bound", () => {
    expect(competitionAnalysisDateInput(null, "UTC")).toBe("");
  });
});
