import { describe, expect, test } from "vitest";
import { REPORT_COMMON_PRESETS } from "@scout-for-lol/data";
import { ValidatedReportAiFinalDraftSchema } from "./report-query-final-schema.ts";

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
    const queryText = REPORT_COMMON_PRESETS[0]?.query;
    if (queryText === undefined) throw new Error("Expected a common preset");
    expect(ValidatedReportAiFinalDraftSchema.parse(draft(queryText))).toEqual(
      draft(queryText),
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
