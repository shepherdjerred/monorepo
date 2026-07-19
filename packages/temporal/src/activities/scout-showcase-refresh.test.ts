import { describe, expect, test } from "bun:test";
import { isGeneratedAtOnlyDiff } from "./scout-showcase-refresh.ts";

const TIMESTAMP_ONLY_DIFF = [
  "diff --git a/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json b/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "index 1234567..89abcde 100644",
  "--- a/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "+++ b/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "@@ -2,3 +2,3 @@",
  '   "version": 1,',
  '-  "generatedAt": "2026-06-20T02:58:45.303Z",',
  '+  "generatedAt": "2026-07-19T12:00:00.000Z",',
  '   "assets": [',
].join("\n");

const MIXED_DIFF = [
  "--- a/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  "+++ b/packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json",
  '-  "generatedAt": "2026-06-20T02:58:45.303Z",',
  '+  "generatedAt": "2026-07-19T12:00:00.000Z",',
  '-      "byteLength": 100,',
  '+      "byteLength": 200,',
].join("\n");

describe("isGeneratedAtOnlyDiff", () => {
  test("true for a generatedAt-only diff", () => {
    expect(isGeneratedAtOnlyDiff(TIMESTAMP_ONLY_DIFF)).toBe(true);
  });

  test("false when other lines changed too", () => {
    expect(isGeneratedAtOnlyDiff(MIXED_DIFF)).toBe(false);
  });

  test("false for an empty diff (no changed lines = not a timestamp diff)", () => {
    expect(isGeneratedAtOnlyDiff("")).toBe(false);
  });
});
