import { describe, expect, test } from "bun:test";
import { ExploreTraceEntrySchema } from "#src/model/explore.ts";

describe("ExploreTraceEntrySchema", () => {
  test("normalizes a stored legacy trace entry", () => {
    expect(
      ExploreTraceEntrySchema.parse({
        toolName: "run_report_query",
        message: "Got results.",
        ok: true,
      }),
    ).toEqual({
      toolCallId: "legacy-run_report_query",
      toolName: "run_report_query",
      message: "Got results.",
      status: "succeeded",
      durationMs: null,
      details: null,
      rawInput: null,
      rawOutput: null,
    });
  });
});
