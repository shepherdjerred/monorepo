import { describe, expect, test } from "vitest";
import {
  GAME_FACT_KINDS,
  GameFactSchema,
  KeywordFactSchema,
  gameFactPath,
} from "#src/game-facts/schema.ts";

const keyword = {
  kind: "keyword",
  patch: "16.23.1",
  key: "charm",
  name: "Charm",
  icon: null,
  keyFact: null,
  facts: [],
  description: "Forced to walk toward the source of the Charm.",
  parts: [],
} as const;

describe("GameFact schema", () => {
  test("covers every kind the tooltips open", () => {
    expect(GAME_FACT_KINDS).toEqual([
      "champion",
      "ability",
      "item",
      "rune",
      "summoner-spell",
      "keyword",
    ]);
  });

  test("a keyword round-trips with no icon and no key fact", () => {
    const parsed = GameFactSchema.parse(structuredClone(keyword));
    expect(parsed).toEqual(keyword);
    expect(KeywordFactSchema.safeParse(keyword).success).toBe(true);
  });

  test("discriminates on kind and rejects another kind's fields", () => {
    expect(GameFactSchema.safeParse({ ...keyword, kind: "rune" }).success).toBe(
      false,
    );
    expect(
      GameFactSchema.safeParse({ ...keyword, kind: "plant" }).success,
    ).toBe(false);
  });

  test("rejects an icon outside the game image folders", () => {
    expect(
      GameFactSchema.safeParse({ ...keyword, icon: "../secret.png" }).success,
    ).toBe(false);
  });

  test("rejects a part with no name", () => {
    expect(
      GameFactSchema.safeParse({
        ...keyword,
        parts: [{ kind: "item", key: "1001", name: "", icon: null }],
      }).success,
    ).toBe(false);
  });

  test("addresses a fact file below the game asset root", () => {
    expect(gameFactPath("summoner-spell", "14")).toBe(
      "facts/summoner-spell/14.json",
    );
  });
});
