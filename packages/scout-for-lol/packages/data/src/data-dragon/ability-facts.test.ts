import { readdir, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import {
  ChampionAbilityFactsSchema,
  getAbilityFacts,
  suggestChampionNames,
} from "./ability-facts.ts";

const ABILITY_FACTS_DIR = `${import.meta.dirname}/assets/ability-facts`;

describe("committed ability-facts assets", () => {
  test("every committed file parses against the reader schema", async () => {
    const entries = await readdir(ABILITY_FACTS_DIR);
    const files = entries.filter((name) => name.endsWith(".json"));
    // One file per non-Classic champion in the committed Data Dragon snapshot.
    expect(files.length).toBeGreaterThan(150);
    for (const file of files) {
      const raw: unknown = JSON.parse(
        await readFile(`${ABILITY_FACTS_DIR}/${file}`, "utf8"),
      );
      const facts = ChampionAbilityFactsSchema.parse(raw);
      expect(`${facts.championKey}.json`).toBe(file);
    }
  });
});

describe("getAbilityFacts", () => {
  test("Cho'Gath R rank 1 Feast damage is 300 (golden)", async () => {
    const lookup = await getAbilityFacts("cho gath");
    expect(lookup.status).toBe("found");
    if (lookup.status !== "found") {
      return;
    }
    const feast = lookup.facts.abilities.R;
    // dataValues arrays are rank-1-first: [0] is the rank 1 value.
    expect(feast.dataValues["RBaseDamage"]?.[0]).toBe(300);
    expect(feast.dataValues["RBaseDamage"]).toEqual([300, 475, 650]);
  });

  test("Karthus R cooldown by rank is 200/180/160 (golden)", async () => {
    const lookup = await getAbilityFacts("Karthus");
    expect(lookup.status).toBe("found");
    if (lookup.status !== "found") {
      return;
    }
    expect(lookup.facts.abilities.R.cooldownByRank).toEqual([200, 180, 160]);
  });

  test("Pyke R description mentions the execute (golden)", async () => {
    const lookup = await getAbilityFacts("pyke");
    expect(lookup.status).toBe("found");
    if (lookup.status !== "found") {
      return;
    }
    expect(lookup.facts.abilities.R.resolvedDescription).toMatch(/execut/i);
  });

  test("resolves spoken aliases and punctuation-free forms", async () => {
    for (const spoken of ["kai sa", "jarvan four", "doctor mundo", "wukong"]) {
      const lookup = await getAbilityFacts(spoken);
      expect(lookup.status, `expected "${spoken}" to resolve`).toBe("found");
    }
  });

  test("caches repeated lookups", async () => {
    const first = await getAbilityFacts("Chogath");
    const second = await getAbilityFacts("cho'gath");
    expect(first.status).toBe("found");
    if (first.status !== "found" || second.status !== "found") {
      return;
    }
    expect(second.facts).toBe(first.facts);
  });

  test("unknown champion returns closest-match suggestions, not a throw", async () => {
    const lookup = await getAbilityFacts("chogarth");
    expect(lookup.status).toBe("not_found");
    if (lookup.status !== "not_found") {
      return;
    }
    expect(lookup.suggestions).toContain("Cho'Gath");
  });

  test("nonsense input still produces suggestions", async () => {
    const lookup = await getAbilityFacts("xxxxqqqqzzzz");
    expect(lookup.status).toBe("not_found");
    if (lookup.status !== "not_found") {
      return;
    }
    expect(lookup.suggestions).toHaveLength(3);
  });
});

describe("suggestChampionNames", () => {
  test("prefers substring matches", () => {
    expect(suggestChampionNames("kart")).toContain("Karthus");
  });

  test("falls back to edit distance for near-misses", () => {
    expect(suggestChampionNames("velcoz")).toContain("Vel'Koz");
  });
});
