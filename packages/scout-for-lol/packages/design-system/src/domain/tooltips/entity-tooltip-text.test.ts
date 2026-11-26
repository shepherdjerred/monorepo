import { describe, expect, test } from "vitest";
import { splitKeywords, splitPassives } from "./entity-tooltip-text.ts";
import type { GameFactPart } from "./game-fact-types.ts";

const charm: GameFactPart = {
  kind: "keyword",
  key: "charm",
  name: "Charm",
  icon: null,
};
const cleanse: GameFactPart = {
  kind: "keyword",
  key: "cleanse",
  name: "Cleanse",
  icon: null,
};

describe("splitKeywords", () => {
  test("wraps the first mention and keeps its inflection", () => {
    const { segments, unmentioned } = splitKeywords(
      "Ahri blows a kiss that Charms the first enemy hit.",
      [charm],
    );
    expect(segments).toEqual([
      { type: "text", text: "Ahri blows a kiss that " },
      { type: "keyword", text: "Charms", part: charm },
      { type: "text", text: " the first enemy hit." },
    ]);
    expect(unmentioned).toEqual([]);
  });

  test("returns a keyword the text never mentions", () => {
    const { segments, unmentioned } = splitKeywords("Deals damage.", [cleanse]);
    expect(segments).toEqual([{ type: "text", text: "Deals damage." }]);
    expect(unmentioned).toEqual([cleanse]);
  });

  test("only matches at a word start", () => {
    const { unmentioned } = splitKeywords("An uncharmed target.", [charm]);
    expect(unmentioned).toEqual([charm]);
  });
});

describe("splitPassives", () => {
  test("splits named passives into paragraphs", () => {
    expect(
      splitPassives(
        "Scorn: Gain 20 Ultimate Ability Haste. Hatefog: Damaging a champion burns the ground.",
      ),
    ).toEqual([
      { name: "Scorn", text: "Gain 20 Ultimate Ability Haste." },
      { name: "Hatefog", text: "Damaging a champion burns the ground." },
    ]);
  });

  test("leaves plain text alone", () => {
    expect(splitPassives("Grants 45 Ability Power.")).toEqual([
      { name: undefined, text: "Grants 45 Ability Power." },
    ]);
  });
});
