import { describe, expect, test } from "vitest";

import { assertNoLinearContextLeak } from "./prompt.ts";

const context =
  "Linear comments present for agent context:\n" +
  JSON.stringify("Keep the API response backwards compatible.") +
  "\n" +
  JSON.stringify("Please update the empty state.");

describe("assertNoLinearContextLeak", () => {
  test("allows summaries without Linear-only comment text", () => {
    expect(() =>
      assertNoLinearContextLeak("Updated the response handling.", context),
    ).not.toThrow();
  });

  test("rejects a summary that repeats a Linear-only comment", () => {
    expect(() =>
      assertNoLinearContextLeak(
        "Updated the response handling: Keep the API response backwards compatible.",
        context,
      ),
    ).toThrow("refusing to publish");
  });

  test("does nothing when there are no comments", () => {
    expect(() => assertNoLinearContextLeak("Any summary", null)).not.toThrow();
  });
});
