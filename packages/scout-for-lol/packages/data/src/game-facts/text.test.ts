import { describe, expect, test } from "vitest";
import {
  formatByRank,
  resolvedLeadingText,
  splitSentences,
  stripMarkup,
  trimDescription,
} from "#src/game-facts/text.ts";

describe("stripMarkup", () => {
  test("removes game tags, breaks and entities", () => {
    expect(
      stripMarkup(
        "<mainText>Deal <magicDamage>magic damage</magicDamage>.<br><br>Heal &amp; shield&nbsp;allies.</mainText>",
      ),
    ).toBe("Deal magic damage. Heal & shield allies.");
  });

  test("drops flavor text with its content", () => {
    expect(stripMarkup("Fast.<flavorText>Lore, not a fact.</flavorText>")).toBe(
      "Fast.",
    );
  });

  test("keeps rank slashes and percentages intact", () => {
    expect(stripMarkup("<b>80/120/160</b> (+85% AP) damage.")).toBe(
      "80/120/160 (+85% AP) damage.",
    );
  });
});

describe("sentences", () => {
  test("splits on a capital after terminal punctuation, not on decimals", () => {
    expect(
      splitSentences("Charms for 1.2/1.35 seconds. Deals (+85% AP) damage."),
    ).toEqual(["Charms for 1.2/1.35 seconds.", "Deals (+85% AP) damage."]);
  });

  test("does not split after e.g.", () => {
    expect(
      splitSentences("Slows enemies, e.g. Ahri's targets. Then stops."),
    ).toEqual(["Slows enemies, e.g. Ahri's targets.", "Then stops."]);
  });

  test("keeps two short sentences and one when the pair runs long", () => {
    expect(trimDescription("One. Two. Three.")).toBe("One. Two.");
    const long = `${"a".repeat(150)}. B${"b".repeat(150)}.`;
    expect(trimDescription(long)).toBe(`${"a".repeat(150)}.`);
  });

  test("drops a trailing sentence Data Dragon cut off", () => {
    expect(
      trimDescription("First sentence. Once a powerful yet wayward..."),
    ).toBe("First sentence.");
    expect(trimDescription("Only a cut off start...")).toBe(
      "Only a cut off start...",
    );
  });

  test("stops before the first sentence with an unresolved token", () => {
    expect(resolvedLeadingText("Deals 80 damage. Slows by {{ slow }}.")).toBe(
      "Deals 80 damage.",
    );
    expect(resolvedLeadingText("Deals {{ damage }} damage. Slows.")).toBe("");
  });
});

describe("formatByRank", () => {
  test("collapses a flat table and joins a varying one", () => {
    expect(formatByRank([12, 12, 12, 12, 12])).toBe("12");
    expect(formatByRank([9, 8, 7, 6, 5])).toBe("9/8/7/6/5");
    expect(formatByRank([1.2, 1.35, 1.5])).toBe("1.2/1.35/1.5");
    expect(formatByRank([])).toBe("");
  });
});
