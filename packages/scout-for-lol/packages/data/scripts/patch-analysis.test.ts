import { describe, expect, test } from "bun:test";
import { buildAnalysisPrompt, parsePatchAnalysis } from "./patch-analysis.ts";
import type { RiotPatch } from "./riot-patch.ts";

const PATCH: RiotPatch = {
  patch: "26.13",
  major: 26,
  minor: 13,
  title: "Patch 26.13 Notes",
  tagline: "Jungle eats good",
  url: "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-13-notes/",
};

const DATE = new Date("2026-07-01T12:00:00Z");

function claudeStdout(analysis: unknown): string {
  return JSON.stringify({ result: JSON.stringify(analysis) });
}

const VALID_ANALYSIS = {
  overview: "A jungle-focused patch.",
  themes: ["jungle buffs"],
  summary: ["Junglers eat better", "Marksmen spike later"],
  champions: [
    {
      name: "Lee Sin",
      direction: "buff",
      magnitude: "major",
      summary: "Q damage up",
      details: "Lee Sin skirmishes harder early.",
    },
  ],
  items: [],
  systems: [
    {
      area: "Jungle",
      direction: "buff",
      magnitude: "moderate",
      summary: "Camp gold up",
      details: "Camps grant more gold.",
    },
  ],
};

describe("buildAnalysisPrompt", () => {
  test("includes the patch url and structured-output instruction", () => {
    const prompt = buildAnalysisPrompt(PATCH);
    expect(prompt).toContain(PATCH.url);
    expect(prompt).toContain("champions");
    expect(prompt).toContain("Output ONLY the JSON object");
  });
});

describe("parsePatchAnalysis", () => {
  test("merges deterministic patch metadata into a validated changeset", () => {
    const changeset = parsePatchAnalysis(
      claudeStdout(VALID_ANALYSIS),
      PATCH,
      DATE,
    );
    expect(changeset.patch).toBe("26.13");
    expect(changeset.title).toBe(PATCH.title);
    expect(changeset.url).toBe(PATCH.url);
    expect(changeset.date).toBe("2026 07 01");
    expect(changeset.champions[0]?.name).toBe("Lee Sin");
    expect(changeset.systems[0]?.area).toBe("Jungle");
  });

  test("tolerates a fenced code block around the JSON", () => {
    const stdout = JSON.stringify({
      result: "```json\n" + JSON.stringify(VALID_ANALYSIS) + "\n```",
    });
    const changeset = parsePatchAnalysis(stdout, PATCH, DATE);
    expect(changeset.overview).toBe("A jungle-focused patch.");
  });

  test("throws when the model output violates the schema", () => {
    const bad = { ...VALID_ANALYSIS, summary: [] };
    expect(() => parsePatchAnalysis(claudeStdout(bad), PATCH, DATE)).toThrow();
  });

  test("throws when the result field is missing", () => {
    expect(() =>
      parsePatchAnalysis(JSON.stringify({ nope: true }), PATCH, DATE),
    ).toThrow();
  });
});
