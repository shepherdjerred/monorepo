import { describe, expect, test } from "vitest";
import { getGameAsset } from "#src/browser-assets.ts";
import { getRuneInfo, getRuneTreeForRune, listRunes } from "./runes.ts";

describe("historical runes", () => {
  test("keeps removed runes available for recorded matches", () => {
    expect(listRunes().some((rune) => rune.id === 8138)).toBe(false);
    expect(getRuneInfo(8138)).toMatchObject({
      name: "Eyeball Collection",
      icon: "perk-images/Styles/Domination/EyeballCollection/EyeballCollection.png",
    });
    expect(getRuneTreeForRune(8138)).toMatchObject({
      treeId: 8100,
      treeName: "Domination",
    });
    expect(getGameAsset("rune", "EyeballCollection.png").relativePath).toBe(
      "img/rune/EyeballCollection.png",
    );
  });
});
