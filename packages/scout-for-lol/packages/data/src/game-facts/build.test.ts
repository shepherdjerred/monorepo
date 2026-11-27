import { beforeAll, describe, expect, test } from "vitest";
import { gameAssetManifest } from "#src/browser-assets.ts";
import {
  buildAllGameFacts,
  buildKeywordFact,
  parseItemDescription,
} from "#src/game-facts/build.ts";
import {
  AbilityFactSchema,
  ChampionFactSchema,
  ItemFactSchema,
  RuneFactSchema,
  SummonerSpellFactSchema,
  type AbilityFact,
  type ChampionFact,
  type GameFact,
  type ItemFact,
  type RuneFact,
  type SummonerSpellFact,
} from "#src/game-facts/schema.ts";
import { loadGameFactSources } from "#src/game-facts/sources.ts";

let facts: GameFact[] = [];

beforeAll(async () => {
  facts = buildAllGameFacts(await loadGameFactSources());
});

function lookup(kind: GameFact["kind"], key: string): GameFact {
  const found = facts.find((fact) => fact.kind === kind && fact.key === key);
  if (found === undefined) throw new Error(`No ${kind} fact ${key}`);
  return found;
}

const champion = (key: string): ChampionFact =>
  ChampionFactSchema.parse(lookup("champion", key));
const ability = (key: string): AbilityFact =>
  AbilityFactSchema.parse(lookup("ability", key));
const item = (key: string): ItemFact =>
  ItemFactSchema.parse(lookup("item", key));
const rune = (key: string): RuneFact =>
  RuneFactSchema.parse(lookup("rune", key));
const spell = (key: string): SummonerSpellFact =>
  SummonerSpellFactSchema.parse(lookup("summoner-spell", key));

describe("champion facts", () => {
  test("Ahri carries her header, three facts and five ability parts", () => {
    const ahri: ChampionFact = champion("Ahri");
    expect(ahri.name).toBe("Ahri");
    expect(ahri.title).toBe("the Nine-Tailed Fox");
    expect(ahri.roles).toEqual(["Mage", "Assassin"]);
    expect(ahri.keyFact).toEqual({ label: "Roles", value: "Mage, Assassin" });
    expect(ahri.icon).toBe("img/champion/Ahri.png");
    expect(ahri.art).toBe("img/champion-splash/Ahri_0.jpg");
    expect(ahri.facts).toEqual([
      { label: "Health", value: "590" },
      { label: "Move speed", value: "330" },
      { label: "Attack range", value: "550" },
    ]);
    expect(ahri.parts.map((part) => [part.key, part.name])).toEqual([
      ["Ahri-passive", "Essence Theft"],
      ["Ahri-Q", "Orb of Deception"],
      ["Ahri-W", "Fox-Fire"],
      ["Ahri-E", "Charm"],
      ["Ahri-R", "Spirit Rush"],
    ]);
    expect(ahri.description).toMatch(/^Innately connected to the magic/);
    expect(ahri.description).not.toMatch(/\.\.\.$/);
  });
});

describe("ability facts", () => {
  test("Charm has its real ranks and a resolved one-sentence description", () => {
    const charm: AbilityFact = ability("Ahri-E");
    expect(charm.name).toBe("Charm");
    expect(charm.slot).toBe("E");
    expect(charm.championName).toBe("Ahri");
    expect(charm.maxRank).toBe(5);
    expect(charm.cooldownByRank).toEqual([12, 12, 12, 12, 12]);
    expect(charm.costByRank).toEqual([60, 60, 60, 60, 60]);
    expect(charm.costType).toBe("Mana");
    expect(charm.rangeByRank).toEqual([975, 975, 975, 975, 975]);
    expect(charm.keyFact).toEqual({ label: "Cooldown", value: "12 s" });
    expect(charm.facts).toEqual([
      { label: "Cost", value: "60 Mana" },
      { label: "Range", value: "975" },
    ]);
    expect(charm.description).toBe(
      "Ahri blows a kiss that Charms the first enemy hit for 1.2/1.35/1.5/1.65/1.8 seconds and deals 80/120/160/200/240 (+85% AP) magic damage.",
    );
  });

  test("a cooldown that changes by rank is shown by rank", () => {
    expect(ability("Ahri-W").keyFact.value).toBe("9/8/7/6/5 s");
  });

  test("a passive has no ranks, cost or range", () => {
    const passive = ability("Ahri-passive");
    expect(passive.slot).toBe("passive");
    expect(passive.cooldownByRank).toEqual([]);
    expect(passive.keyFact).toEqual({ label: "Slot", value: "Passive" });
    expect(passive.facts).toEqual([]);
  });

  test("abilities never show an unresolved token or markup", () => {
    for (const fact of facts) {
      if (fact.kind !== "ability") continue;
      expect(fact.description, fact.key).not.toMatch(/\{\{|<\/?\w+/);
      expect(fact.costType, fact.key).not.toContain("{{");
    }
  });

  test("an ability with no generated text falls back to the game's description", () => {
    expect(ability("Aphelios-Q").description).toMatch(
      /^Aphelios has 5 different activated abilities/,
    );
  });
});

describe("item facts", () => {
  test("Malignance reads its own stats and passives, not its plaintext", () => {
    const malignance: ItemFact = item("3118");
    expect(malignance.name).toBe("Malignance");
    expect(malignance.goldTotal).toBe(2700);
    expect(malignance.goldCombine).toBe(650);
    expect(malignance.keyFact).toEqual({ label: "Cost", value: "2700 gold" });
    expect(malignance.facts).toEqual([
      { label: "Ability Power", value: "90" },
      { label: "Mana", value: "600" },
      { label: "Ability Haste", value: "15" },
    ]);
    expect(malignance.description).toBe(
      "Scorn: Gain 20 Ultimate Ability Haste. Hatefog: Damaging a champion with your Ultimate burns the ground beneath them for 3s, dealing magic damage per second and reducing their Magic Resist.",
    );
    // Data Dragon's plaintext for this item is another item's sentence
    // (Tracker AI-953).
    expect(malignance.description).not.toContain("Partner with an ally");
    expect(malignance.parts.map((part) => [part.key, part.name])).toEqual([
      ["3802", "Lost Chapter"],
      ["1026", "Blasting Wand"],
    ]);
  });

  test("an item with only stats gets a stat summary", () => {
    expect(item("1001").description).toBe("Grants 25 Move Speed.");
  });

  test("a quest item with no text has an empty description", () => {
    expect(item("3865").description).toBe("");
  });

  test("a segment that still carries a token is left out", () => {
    const embrace = item("224637");
    expect(embrace.description).not.toContain("{{");
    expect(embrace.description).toMatch(/^Dark Pact:/);
  });

  test("parses stats, lead text and named effects from the markup", () => {
    expect(
      parseItemDescription(
        "<mainText><stats><attention>45</attention> Attack Damage<br><attention>40%</attention> Attack Speed</stats><br><br><passive>Bring It Down</passive><br>Every third Attack deals <physicalDamage>bonus physical damage</physicalDamage>.</mainText>",
      ),
    ).toEqual({
      stats: [
        { label: "Attack Damage", value: "45" },
        { label: "Attack Speed", value: "40%" },
      ],
      lead: "",
      effects: [
        {
          name: "Bring It Down",
          text: "Every third Attack deals bonus physical damage.",
        },
      ],
    });
  });

  test("an unrecognised stat line fails loudly", () => {
    expect(() =>
      parseItemDescription("<mainText><stats>mystery</stats></mainText>"),
    ).toThrow("Unrecognised item stat line");
  });

  test("every named item has a fact whose recipe parts exist", () => {
    const byKey = new Set(
      facts.filter((fact) => fact.kind === "item").map((fact) => fact.key),
    );
    for (const fact of facts) {
      if (fact.kind !== "item") continue;
      expect(fact.description, fact.key).not.toMatch(/<\/?\w+|\{\{/);
      for (const part of fact.parts) {
        expect(byKey.has(part.key), `${fact.key} part ${part.key}`).toBe(true);
      }
    }
  });
});

describe("rune facts", () => {
  test("Electrocute names its tree, keystone slot, damage and cooldown", () => {
    const electrocute: RuneFact = rune("8112");
    expect(electrocute.name).toBe("Electrocute");
    expect(electrocute.tree).toBe("Domination");
    expect(electrocute.keyFact).toEqual({ label: "Tree", value: "Domination" });
    expect(electrocute.icon).toBe("img/rune/Electrocute.png");
    expect(electrocute.facts).toEqual([
      { label: "Type", value: "Keystone" },
      { label: "Damage", value: "70 - 240 (+0.1 bonus AD, +0.05 AP) damage" },
      { label: "Cooldown", value: "20s" },
    ]);
    expect(electrocute.description).toBe(
      "Hitting a champion with 3 separate attacks or abilities in 3s deals bonus adaptive damage.",
    );
  });
});

describe("summoner spell facts", () => {
  test("Ignite carries its cooldown, range and description", () => {
    const ignite: SummonerSpellFact = spell("14");
    expect(ignite.name).toBe("Ignite");
    expect(ignite.cooldownSeconds).toBe(180);
    expect(ignite.keyFact).toEqual({ label: "Cooldown", value: "180 s" });
    expect(ignite.icon).toBe("img/spell/SummonerDot.png");
    expect(ignite.facts).toEqual([
      { label: "Range", value: "600" },
      { label: "Unlocks", value: "Level 9" },
    ]);
    expect(ignite.description).toBe(
      "Deals true damage over time to target enemy champion and reduces healing effects on them for the duration.",
    );
  });
});

describe("every entity", () => {
  test("pins one patch and unique kind/key pairs", () => {
    expect(new Set(facts.map((fact) => fact.patch))).toEqual(
      new Set([gameAssetManifest.sourceVersion]),
    );
    const identities = facts.map((fact) => `${fact.kind}/${fact.key}`);
    expect(new Set(identities).size).toBe(identities.length);
  });

  test("every icon, art and part icon is a shipped game image", () => {
    const shipped = new Set(
      gameAssetManifest.assets.map((asset) => asset.relativePath),
    );
    for (const fact of facts) {
      const paths = [
        fact.icon,
        ...(fact.kind === "champion" ? [fact.art] : []),
        ...fact.parts.map((part) => part.icon),
      ];
      for (const path of paths) {
        if (path === null) continue;
        expect(shipped.has(path), `${fact.kind}/${fact.key} ${path}`).toBe(
          true,
        );
      }
    }
  });

  test("champion parts are abilities that have their own facts", () => {
    const keys = new Set(
      facts.filter((fact) => fact.kind === "ability").map((fact) => fact.key),
    );
    for (const fact of facts) {
      if (fact.kind !== "champion") continue;
      expect(fact.parts).toHaveLength(5);
      for (const part of fact.parts) expect(keys.has(part.key)).toBe(true);
    }
  });

  test("descriptions stay a sentence or two", () => {
    for (const fact of facts) {
      expect(fact.description.length, `${fact.kind}/${fact.key}`).toBeLessThan(
        520,
      );
    }
  });
});

describe("buildKeywordFact", () => {
  test("turns a glossary entry into a keyword fact a tooltip can show", () => {
    expect(
      buildKeywordFact("16.23.1", {
        id: "charmed",
        term: "Charmed",
        definition: "Walks toward the caster and cannot attack or cast.",
      }),
    ).toEqual({
      kind: "keyword",
      patch: "16.23.1",
      key: "charmed",
      name: "Charmed",
      description: "Walks toward the caster and cannot attack or cast.",
      facts: [],
      parts: [],
      icon: null,
      keyFact: null,
    });
  });
});
