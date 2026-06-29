import { describe, expect, test } from "bun:test";
import { buildHighlightsPrompt, parseHighlights } from "./patch-highlights.ts";
import type { RiotPatch } from "./riot-patch.ts";

const PATCH: RiotPatch = {
  patch: "26.13",
  major: 26,
  minor: 13,
  title: "League of Legends Patch 26.13 Notes",
  tagline: "Absolutely no demons allowed. - Locke",
  url: "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-13-notes",
};

function claudeJson(resultText: string): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: resultText,
    session_id: "abc",
  });
}

describe("buildHighlightsPrompt", () => {
  test("includes the real patch number and notes URL", () => {
    const prompt = buildHighlightsPrompt(PATCH);
    expect(prompt).toContain("patch 26.13");
    expect(prompt).toContain(PATCH.url);
    expect(prompt).toContain("WebFetch");
    expect(prompt).toContain("JSON array");
  });
});

describe("parseHighlights", () => {
  test("parses a clean JSON array from the result field", () => {
    const stdout = claudeJson(
      '["New champion Locke joins", "Arena gets new augments"]',
    );
    expect(parseHighlights(stdout)).toEqual([
      "New champion Locke joins",
      "Arena gets new augments",
    ]);
  });

  test("tolerates a ```json fenced block", () => {
    const stdout = claudeJson('```json\n["A", "B"]\n```');
    expect(parseHighlights(stdout)).toEqual(["A", "B"]);
  });

  test("extracts the array when wrapped in stray prose", () => {
    const stdout = claudeJson('Here are the highlights:\n["A", "B", "C"]');
    expect(parseHighlights(stdout)).toEqual(["A", "B", "C"]);
  });

  test("throws when stdout is not JSON", () => {
    expect(() => parseHighlights("not json at all")).toThrow(/not JSON/);
  });

  test("throws when the result has no JSON array", () => {
    expect(() => parseHighlights(claudeJson("no array here"))).toThrow();
  });

  test("throws when the array is empty (schema requires 1-5)", () => {
    expect(() => parseHighlights(claudeJson("[]"))).toThrow();
  });

  test("throws when there are more than 5 highlights", () => {
    expect(() =>
      parseHighlights(claudeJson('["1","2","3","4","5","6"]')),
    ).toThrow();
  });
});
