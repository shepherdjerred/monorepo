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

  test("preserves the completion watermark for deadline settlement", () => {
    expect(
      PostMatchDiscoveryResultSchema.parse({
        matches: [],
        evidenceComplete: true,
        evidenceWatermark: "2026-09-01T16:00:00.000Z",
      }).evidenceWatermark,
    ).toBe("2026-09-01T16:00:00.000Z");
  });
});
