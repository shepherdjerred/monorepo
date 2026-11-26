import ahriJson from "@scout-for-lol/data/data-dragon/assets/facts/champion/Ahri.json" with { type: "json" };
import ahriEJson from "@scout-for-lol/data/data-dragon/assets/facts/ability/Ahri-E.json" with { type: "json" };
import ahriPassiveJson from "@scout-for-lol/data/data-dragon/assets/facts/ability/Ahri-passive.json" with { type: "json" };
import ahriQJson from "@scout-for-lol/data/data-dragon/assets/facts/ability/Ahri-Q.json" with { type: "json" };
import ahriRJson from "@scout-for-lol/data/data-dragon/assets/facts/ability/Ahri-R.json" with { type: "json" };
import ahriWJson from "@scout-for-lol/data/data-dragon/assets/facts/ability/Ahri-W.json" with { type: "json" };
import blastingWandJson from "@scout-for-lol/data/data-dragon/assets/facts/item/1026.json" with { type: "json" };
import sapphireCrystalJson from "@scout-for-lol/data/data-dragon/assets/facts/item/1027.json" with { type: "json" };
import amplifyingTomeJson from "@scout-for-lol/data/data-dragon/assets/facts/item/1052.json" with { type: "json" };
import glowingMoteJson from "@scout-for-lol/data/data-dragon/assets/facts/item/2022.json" with { type: "json" };
import malignanceJson from "@scout-for-lol/data/data-dragon/assets/facts/item/3118.json" with { type: "json" };
import lostChapterJson from "@scout-for-lol/data/data-dragon/assets/facts/item/3802.json" with { type: "json" };
import electrocuteJson from "@scout-for-lol/data/data-dragon/assets/facts/rune/8112.json" with { type: "json" };
import cleanseJson from "@scout-for-lol/data/data-dragon/assets/facts/summoner-spell/1.json" with { type: "json" };
import igniteJson from "@scout-for-lol/data/data-dragon/assets/facts/summoner-spell/14.json" with { type: "json" };
import {
  AbilityFactSchema,
  GameFactSchema,
  KeywordFactSchema,
  type GameFact,
  type GameFactPart,
} from "@scout-for-lol/data/game-facts/schema.ts";

/**
 * The facts the tooltip stories load. Everything here is the generated game-fact
 * JSON itself, imported from the data package and validated by its schema; none
 * of it is retyped. Two stand-ins exist, both marked, because the tips
 * glossary that will supply keywords has not landed:
 * `charmKeywordPart` is added to Charm's parts, and `charmKeyword` is the
 * entry it opens.
 */

const patch = ahriJson.patch;

/** The glossary stand-in: Charm's description mentions the keyword it names. */
export const charmKeywordPart: GameFactPart = {
  kind: "keyword",
  key: "charm",
  name: "Charm",
  icon: null,
};

const generatedCharm = AbilityFactSchema.parse(ahriEJson);

/** Charm exactly as generated, plus the keyword part. Only `parts` differs. */
export const charm: GameFact = {
  ...generatedCharm,
  parts: [...generatedCharm.parts, charmKeywordPart],
};

/** Hand-written until the glossary emits keyword facts. */
export const charmKeyword: GameFact = KeywordFactSchema.parse({
  kind: "keyword",
  patch,
  key: "charm",
  name: "Charm",
  description:
    "A charmed champion walks slowly toward whoever charmed them and cannot attack, cast or move on their own.",
  facts: [],
  parts: [
    {
      kind: "summoner-spell",
      key: cleanseJson.key,
      name: cleanseJson.name,
      icon: cleanseJson.icon,
    },
  ],
  icon: null,
  keyFact: { label: "Type", value: "Crowd control" },
});

/** Generated files by the JSON they came from, for the drift test. */
export const generatedFacts: readonly GameFact[] = [
  ahriJson,
  ahriEJson,
  ahriPassiveJson,
  ahriQJson,
  ahriRJson,
  ahriWJson,
  blastingWandJson,
  sapphireCrystalJson,
  amplifyingTomeJson,
  glowingMoteJson,
  malignanceJson,
  lostChapterJson,
  electrocuteJson,
  cleanseJson,
  igniteJson,
].map((json) => GameFactSchema.parse(json));

/** What a story's loader can answer: the generated facts, Charm with its keyword, and the keyword. */
export const fixtureFacts: readonly GameFact[] = [
  ...generatedFacts.filter(
    (fact) => !(fact.kind === "ability" && fact.key === "Ahri-E"),
  ),
  charm,
  charmKeyword,
];
