import { describe, expect, test } from "vitest";

import { assertNoTrackerContextLeak } from "./prompt.ts";

const context =
  "Tracker comments present for agent context:\n" +
  JSON.stringify("Keep the API response backwards compatible.") +
  "\n" +
  JSON.stringify("Please update the empty state.");

describe("assertNoTrackerContextLeak", () => {
  test("allows summaries without Tracker-only comment text", () => {
    expect(() =>
      assertNoTrackerContextLeak("Updated the response handling.", context),
    ).not.toThrow();
  });

  test("rejects a summary that repeats a Tracker-only comment", () => {
    expect(() =>
      assertNoTrackerContextLeak(
        "Updated the response handling: Keep the API response backwards compatible.",
        context,
      ),
    ).toThrow("refusing to publish");
  });

  test("does nothing when there are no comments", () => {
    expect(() => assertNoTrackerContextLeak("Any summary", null)).not.toThrow();
  });
});
