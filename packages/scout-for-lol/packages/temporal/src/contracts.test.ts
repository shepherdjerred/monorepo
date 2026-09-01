import { describe, expect, test } from "vitest";
import { PostMatchDiscoveryResultSchema } from "./contracts.ts";

describe("post-match discovery result compatibility", () => {
  test("treats pre-field activity completions as complete evidence", () => {
    expect(
      PostMatchDiscoveryResultSchema.parse({ matches: [] }).evidenceComplete,
    ).toBe(true);
  });

  test("preserves an explicit incomplete-evidence barrier", () => {
    expect(
      PostMatchDiscoveryResultSchema.parse({
        matches: [],
        evidenceComplete: false,
      }).evidenceComplete,
    ).toBe(false);
  });
});
