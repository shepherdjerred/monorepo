import { describe, expect, test } from "vitest";
import corpus from "#src/model/reports/explore-scenario-corpus.json" with { type: "json" };
import { ExploreScenarioCorpusSchema } from "#src/model/reports/explore-scenario-corpus.ts";

describe("the Explore scenario corpus", () => {
  const parsed = ExploreScenarioCorpusSchema.parse(corpus);

  test("holds Scout Desktop cases for the coach content limit and for options", () => {
    const desktop = parsed.cases.filter(
      (entry) => entry.surfaces.length === 1 && entry.surfaces[0] === "desktop",
    );
    expect(desktop.map((entry) => entry.id).toSorted()).toEqual([
      "desktop-enemy-cooldowns",
      "desktop-fog-inference",
      "desktop-hidden-identity",
      "desktop-my-stats",
      "desktop-pick-without-context",
    ]);
  });

  test("every content-limit case judges that Scout refuses and does not guess", () => {
    for (const id of [
      "desktop-enemy-cooldowns",
      "desktop-fog-inference",
      "desktop-hidden-identity",
    ]) {
      const entry = parsed.cases.find((candidate) => candidate.id === id);
      const rubric = entry?.turns.flatMap((turn) => turn.expect?.rubric ?? []);
      expect(rubric, id).toBeDefined();
      expect(rubric?.join(" "), id).toMatch(/does not|cannot|Does not/);
    }
  });

  test("the champion-select case asks for options and forbids commands", () => {
    const entry = parsed.cases.find(
      (candidate) => candidate.id === "desktop-pick-without-context",
    );
    const expectation = entry?.turns[0]?.expect;
    expect(expectation?.rubric.join(" ")).toContain("two to four options");
    expect(expectation?.mustNotMention).toContain("you must pick");
  });
});
