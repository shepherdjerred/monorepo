import type { ReactNode } from "react";
import {
  TooltipScoutRow,
  TooltipScoutRows,
} from "#src/domain/tooltips/entity-tooltip-parts.tsx";
import type {
  AbilityFact,
  ChampionFact,
  GameFact,
  GameFactKind,
  GameFactLoader,
  GameFactPart,
  ItemFact,
  KeywordFact,
  RuneFact,
  SummonerSpellFact,
} from "#src/domain/tooltips/game-fact-types.ts";

/**
 * Real game facts for Ahri's tooltips, copied from the generated fact JSON,
 * and the Scout blocks the stories use. A keyword entry is invented: the tips
 * glossary that will supply them has not landed.
 */

const patch = "16.23.1";
const ability = (key: string, name: string): GameFactPart => ({
  kind: "ability",
  key,
  name,
  icon: `img/ability/${key}.png`,
});
const item = (key: string, name: string): GameFactPart => ({
  kind: "item",
  key,
  name,
  icon: `img/item/${key}.png`,
});
const abilityBase: Pick<
  AbilityFact,
  "kind" | "patch" | "parts" | "championKey" | "championName" | "costType"
> = {
  kind: "ability",
  patch,
  parts: [],
  championKey: "Ahri",
  championName: "Ahri",
  costType: "Mana",
};

export const ahri: ChampionFact = {
  kind: "champion",
  patch,
  key: "Ahri",
  name: "Ahri",
  description:
    "Innately connected to the magic of the spirit realm, Ahri is a fox-like vastaya who can manipulate her prey's emotions and consume their essence—receiving flashes of their memory and insight from each soul she consumes.",
  facts: [
    { label: "Health", value: "590" },
    { label: "Move speed", value: "330" },
    { label: "Attack range", value: "550" },
  ],
  parts: [
    ability("Ahri-passive", "Essence Theft"),
    ability("Ahri-Q", "Orb of Deception"),
    ability("Ahri-W", "Fox-Fire"),
    ability("Ahri-E", "Charm"),
    ability("Ahri-R", "Spirit Rush"),
  ],
  icon: "img/champion/Ahri.png",
  art: "img/champion-splash/Ahri_0.jpg",
  title: "the Nine-Tailed Fox",
  roles: ["Mage", "Assassin"],
  keyFact: { label: "Roles", value: "Mage, Assassin" },
};

export const charm: AbilityFact = {
  ...abilityBase,
  key: "Ahri-E",
  name: "Charm",
  description:
    "Ahri blows a kiss that Charms the first enemy hit for 1.2/1.35/1.5/1.65/1.8 seconds and deals 80/120/160/200/240 (+85% AP) magic damage.",
  facts: [
    { label: "Cost", value: "60 Mana" },
    { label: "Range", value: "975" },
  ],
  parts: [{ kind: "keyword", key: "charm", name: "Charm", icon: null }],
  icon: "img/ability/Ahri-E.png",
  slot: "E",
  maxRank: 5,
  cooldownByRank: [12, 12, 12, 12, 12],
  costByRank: [60, 60, 60, 60, 60],
  rangeByRank: [975, 975, 975, 975, 975],
  keyFact: { label: "Cooldown", value: "12 s" },
};

const orb: AbilityFact = {
  ...abilityBase,
  key: "Ahri-Q",
  name: "Orb of Deception",
  description:
    "Ahri throws then pulls back her orb, dealing 35/60/85/110/135 (+50% AP) magic damage on the way out and 35/60/85/110/135 (+50% AP) true damage on the way back.",
  facts: [
    { label: "Cost", value: "55/65/75/85/95 Mana" },
    { label: "Range", value: "970" },
  ],
  icon: "img/ability/Ahri-Q.png",
  slot: "Q",
  maxRank: 5,
  cooldownByRank: [7, 7, 7, 7, 7],
  costByRank: [55, 65, 75, 85, 95],
  rangeByRank: [970, 970, 970, 970, 970],
  keyFact: { label: "Cooldown", value: "7 s" },
};

const foxFire: AbilityFact = {
  ...abilityBase,
  key: "Ahri-W",
  name: "Fox-Fire",
  description:
    "Ahri releases 3 fox-fires that seek nearby enemies and deal 40/60/80/100/120 (+40% AP) magic damage, reduced to 16/24/32/40/48 (+16% AP) damage beyond the first. She also gains 40% Move Speed decaying over 2 seconds.",
  facts: [
    { label: "Cost", value: "30 Mana" },
    { label: "Range", value: "700" },
  ],
  icon: "img/ability/Ahri-W.png",
  slot: "W",
  maxRank: 5,
  cooldownByRank: [9, 8, 7, 6, 5],
  costByRank: [30, 30, 30, 30, 30],
  rangeByRank: [700, 700, 700, 700, 700],
  keyFact: { label: "Cooldown", value: "9/8/7/6/5 s" },
};

export const spiritRush: AbilityFact = {
  ...abilityBase,
  key: "Ahri-R",
  name: "Spirit Rush",
  description:
    "Ahri nimbly dashes, firing 3 essence bolts at nearby enemies, prioritizing champions. These bolts deal 75/125/175 (+35% AP) magic damage each.",
  facts: [
    { label: "Cost", value: "100 Mana" },
    { label: "Range", value: "450" },
  ],
  icon: "img/ability/Ahri-R.png",
  slot: "R",
  maxRank: 3,
  cooldownByRank: [140, 120, 100],
  costByRank: [100, 100, 100],
  rangeByRank: [450, 450, 450],
  keyFact: { label: "Cooldown", value: "140/120/100 s" },
};

const essenceTheft: AbilityFact = {
  ...abilityBase,
  key: "Ahri-passive",
  name: "Essence Theft",
  description:
    "After killing 9 minions or monsters, Ahri heals. After taking down an enemy champion, Ahri heals for a greater amount.",
  facts: [],
  icon: "img/ability/Ahri-passive.png",
  slot: "passive",
  maxRank: 1,
  costType: "",
  cooldownByRank: [],
  costByRank: [],
  rangeByRank: [],
  keyFact: { label: "Slot", value: "Passive" },
};

export const charmed: KeywordFact = {
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
      key: "1",
      name: "Cleanse",
      icon: "img/spell/SummonerBoost.png",
    },
  ],
  icon: null,
  keyFact: { label: "Type", value: "Crowd control" },
};

const cleanse: SummonerSpellFact = {
  kind: "summoner-spell",
  patch,
  key: "1",
  name: "Cleanse",
  description:
    "Removes all disables and summoner spell debuffs affecting your champion and lowers the duration of incoming disables by 65% for 3 seconds.",
  facts: [{ label: "Unlocks", value: "Level 6" }],
  parts: [],
  icon: "img/spell/SummonerBoost.png",
  cooldownSeconds: 240,
  keyFact: { label: "Cooldown", value: "240 s" },
};

export const malignance: ItemFact = {
  kind: "item",
  patch,
  key: "3118",
  name: "Malignance",
  description:
    "Scorn: Gain 20 Ultimate Ability Haste. Hatefog: Damaging a champion with your Ultimate burns the ground beneath them for 3s, dealing magic damage per second and reducing their Magic Resist.",
  facts: [
    { label: "Ability Power", value: "90" },
    { label: "Mana", value: "600" },
    { label: "Ability Haste", value: "15" },
  ],
  parts: [item("3802", "Lost Chapter"), item("1026", "Blasting Wand")],
  icon: "img/item/3118.png",
  goldTotal: 2700,
  goldCombine: 650,
  keyFact: { label: "Cost", value: "2700 gold" },
};

const lostChapter: ItemFact = {
  kind: "item",
  patch,
  key: "3802",
  name: "Lost Chapter",
  description: "Enlighten: Levelling up restores 20% max Mana over 3 seconds.",
  facts: [
    { label: "Ability Power", value: "40" },
    { label: "Mana", value: "300" },
    { label: "Ability Haste", value: "10" },
  ],
  parts: [
    item("1052", "Amplifying Tome"),
    item("1027", "Sapphire Crystal"),
    item("2022", "Glowing Mote"),
  ],
  icon: "img/item/3802.png",
  goldTotal: 1200,
  goldCombine: 250,
  keyFact: { label: "Cost", value: "1200 gold" },
};

const blastingWand: ItemFact = {
  kind: "item",
  patch,
  key: "1026",
  name: "Blasting Wand",
  description: "Grants 45 Ability Power.",
  facts: [{ label: "Ability Power", value: "45" }],
  parts: [],
  icon: "img/item/1026.png",
  goldTotal: 850,
  goldCombine: 850,
  keyFact: { label: "Cost", value: "850 gold" },
};

export const electrocute: RuneFact = {
  kind: "rune",
  patch,
  key: "8112",
  name: "Electrocute",
  description:
    "Hitting a champion with 3 separate attacks or abilities in 3s deals bonus adaptive damage.",
  facts: [
    { label: "Type", value: "Keystone" },
    { label: "Damage", value: "70 - 240 (+0.1 bonus AD, +0.05 AP) damage" },
    { label: "Cooldown", value: "20s" },
  ],
  parts: [],
  icon: "img/rune/Electrocute.png",
  tree: "Domination",
  keyFact: { label: "Tree", value: "Domination" },
};

export const ignite: SummonerSpellFact = {
  kind: "summoner-spell",
  patch,
  key: "14",
  name: "Ignite",
  description:
    "Deals true damage over time to target enemy champion and reduces healing effects on them for the duration.",
  facts: [
    { label: "Range", value: "600" },
    { label: "Unlocks", value: "Level 9" },
  ],
  parts: [],
  icon: "img/spell/SummonerDot.png",
  cooldownSeconds: 180,
  keyFact: { label: "Cooldown", value: "180 s" },
};

const everything: GameFact[] = [
  ahri,
  charm,
  orb,
  foxFire,
  spiritRush,
  essenceTheft,
  charmed,
  cleanse,
  malignance,
  lostChapter,
  blastingWand,
  electrocute,
  ignite,
];

/** A loader over the fixtures above, after `delayMs`; honours abort. */
export function fixtureLoader(delayMs = 0): GameFactLoader {
  return (kind: GameFactKind, key: string, { signal }) =>
    new Promise<GameFact>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        const fact = everything.find(
          (candidate) => candidate.kind === kind && candidate.key === key,
        );
        if (fact === undefined) {
          reject(new Error(`No fixture for ${kind}/${key}`));
          return;
        }
        resolve(fact);
      }, delayMs);
      signal.addEventListener("abort", () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
}

/** A loader that never answers, for the skeleton. */
export const stalledLoader: GameFactLoader = (_kind, _key, { signal }) =>
  new Promise<GameFact>((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

/** A loader whose request fails. */
export const failingLoader: GameFactLoader = () =>
  Promise.reject(new Error("Game fact failed to load (HTTP 404)"));

/** Scout blocks in the shape the mockups use. */
export function scoutFor(kind: GameFactKind, key: string): ReactNode {
  if (kind === "champion") {
    return (
      <TooltipScoutRows context="Patch 16.23, Ranked Solo/Duo, Emerald and above">
        <TooltipScoutRow who="You" you>
          <span>41 games, won 61%</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Friends">
          <span>6 play her</span>
          <span>RiverQuartz is best, at 65%</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>A tier, wins 51.8% of 12,480 games</span>
          <span>Ahead at 15 minutes in 52.4% of 2,460</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "ability" && key === "Ahri-E") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="Everyone">
          <span>Most Ahri players max it last</span>
          <span>Q, then W, then E wins 52.3% of 8,700 games</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "item" && key === "3118") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="You" you>
          <span>In 31 of your 41 Ahri games</span>
          <span>Won 65% of those</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Friends">
          <span>In 62 of their 147 Ahri games</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>Ahri&apos;s most played first item</span>
          <span>That build wins 53.1% of 4,210 games</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "rune") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="You" you>
          <span>In 38 of your 41 Ahri games</span>
          <span>Won 63% of those</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>Ahri&apos;s most played rune page</span>
          <span>Wins 52.6% of 7,840 games</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  if (kind === "summoner-spell" && key === "14") {
    return (
      <TooltipScoutRows>
        <TooltipScoutRow who="You" you>
          <span>In 36 of your 41 Ahri games</span>
          <span>Won 64% of those</span>
        </TooltipScoutRow>
        <TooltipScoutRow who="Everyone">
          <span>With Flash on Ahri, wins 52.1% of 9,900 games</span>
          <span>With Teleport instead, 50.8% of 2,140</span>
        </TooltipScoutRow>
      </TooltipScoutRows>
    );
  }
  return undefined;
}
