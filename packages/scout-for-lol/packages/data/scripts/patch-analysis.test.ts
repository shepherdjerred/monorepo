import { describe, expect, test } from "vitest";
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
    const prompt = buildAnalysisPrompt(PATCH, "Lee Sin: Q damage increased.");
    expect(prompt).toContain(PATCH.url);
    expect(prompt).toContain("champions");
    expect(prompt).toContain("Lee Sin: Q damage increased.");
    expect(prompt).toContain("Output ONLY the JSON object");
  });

  test("asks for changelogHighlights separate from the balance summary", () => {
    const prompt = buildAnalysisPrompt(PATCH, "official notes");
    expect(prompt).toContain("changelogHighlights");
    // The changelog field must be steered toward Scout capabilities, not balance.
    expect(prompt).toContain("new champion");
    expect(prompt).toContain("AT MOST ONE");
  });
});

describe("parsePatchAnalysis", () => {
  test("merges deterministic patch metadata into a validated changeset", () => {
    const changeset = parsePatchAnalysis(VALID_ANALYSIS, PATCH, DATE);
    expect(changeset.patch).toBe("26.13");
    expect(changeset.title).toBe(PATCH.title);
    expect(changeset.url).toBe(PATCH.url);
    expect(changeset.date).toBe("2026 07 01");
    expect(changeset.champions[0]?.name).toBe("Lee Sin");
    expect(changeset.systems[0]?.area).toBe("Jungle");
  });

  test("round-trips changelogHighlights when the model provides them", () => {
    const withHighlights = {
      ...VALID_ANALYSIS,
      changelogHighlights: ["Ranked 5v5 is now supported"],
    };
    const changeset = parsePatchAnalysis(withHighlights, PATCH, DATE);
    expect(changeset.changelogHighlights).toEqual([
      "Ranked 5v5 is now supported",
    ]);
  });

  test("defaults changelogHighlights to [] when the model omits it", () => {
    // VALID_ANALYSIS has no changelogHighlights — the common data-only patch.
    const changeset = parsePatchAnalysis(VALID_ANALYSIS, PATCH, DATE);
    expect(changeset.changelogHighlights).toEqual([]);
  });

  test("rejects prose and fenced JSON", () => {
    expect(() =>
      parsePatchAnalysis(
        "```json\n" + JSON.stringify(VALID_ANALYSIS) + "\n```",
        PATCH,
        DATE,
      ),
    ).toThrow();
  });

  test("throws when the model output violates the schema", () => {
    const bad = { ...VALID_ANALYSIS, summary: [] };
    expect(() => parsePatchAnalysis(bad, PATCH, DATE)).toThrow();
  });

  test("throws when the structured object is missing", () => {
    expect(() => parsePatchAnalysis(undefined, PATCH, DATE)).toThrow();
  });
});
