import { describe, expect, test } from "vitest";
import {
  EXPLORE_SUGGESTIONS,
  PERSISTENT_EXPLORE_SUGGESTION,
} from "@scout-for-lol/data";
import {
  chipCaseId,
  exploreChipCases,
  exploreChipCatalogSha256,
} from "./chips.ts";

describe("exploreChipCases", () => {
  test("covers the whole catalog plus the pinned chip", () => {
    expect(exploreChipCases()).toHaveLength(EXPLORE_SUGGESTIONS.length + 1);
  });

  test("includes the pinned chip that lives outside the catalog", () => {
    const prompts = exploreChipCases().map((entry) => entry.prompt);
    expect(prompts).toContain(PERSISTENT_EXPLORE_SUGGESTION);
  });

  test("every gating condition is represented, so no profile is untested", () => {
    const conditions = new Set(
      exploreChipCases().map((entry) => entry.condition),
    );
    for (const condition of [
      "always",
      "bucks",
      "dares",
      "competitions",
      "hall_of_fame",
      "customs",
      "challenges",
      "reports",
    ]) {
      expect(conditions.has(condition)).toBe(true);
    }
  });

  test("case ids are unique", () => {
    const ids = exploreChipCases().map((entry) => entry.caseId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("chipCaseId", () => {
  test("depends on the prompt, not on catalog position", () => {
    const cases = exploreChipCases();
    const first = cases[0];
    const second = cases[1];
    if (first === undefined || second === undefined) {
      throw new Error("Catalog is unexpectedly empty.");
    }
    expect(chipCaseId(first.prompt)).toBe(first.caseId);
    expect(chipCaseId(second.prompt)).toBe(second.caseId);
    expect(first.caseId).not.toBe(second.caseId);
  });

  test("is stable across calls", () => {
    expect(chipCaseId("Which champion wins most?")).toBe(
      chipCaseId("Which champion wins most?"),
    );
  });

  test("is prefixed so a bundle never confuses a chip with a conversation turn", () => {
    expect(chipCaseId("anything")).toMatch(/^chip:[0-9a-f]{12}$/);
  });
});

describe("exploreChipCatalogSha256", () => {
  test("is a stable sha256", () => {
    expect(exploreChipCatalogSha256()).toMatch(/^[0-9a-f]{64}$/);
    expect(exploreChipCatalogSha256()).toBe(exploreChipCatalogSha256());
  });
});
