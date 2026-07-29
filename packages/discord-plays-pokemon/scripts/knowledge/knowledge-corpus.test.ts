import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  KnowledgeRecordsSchema,
  SourcesSchema,
  type KnowledgeSource,
} from "./model.ts";
import { CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS } from "./pokeapi.ts";

const packageRootUrl = new URL("../..", import.meta.url);
const packageRoot = packageRootUrl.pathname;
const PokeemeraldUpstreamSchema = z.strictObject({
  $schema: z.string().min(1),
  repository: z.url(),
  branch: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
});
const sources = SourcesSchema.parse(
  await Bun.file(new URL("knowledge/sources.json", packageRootUrl)).json(),
);
const pokeemeraldUpstream = PokeemeraldUpstreamSchema.parse(
  await Bun.file(
    new URL(
      sources.pokeemeraldWasm.manifest,
      new URL("knowledge/", packageRootUrl),
    ),
  ).json(),
);
const records = KnowledgeRecordsSchema.parse(
  await Bun.file(`${packageRoot}/knowledge/generated/records.json`).json(),
);
const recordsById = new Map(records.map((record) => [record.id, record]));

function requiredRecord(id: string) {
  const record = recordsById.get(id);
  if (record === undefined) {
    throw new Error(`generated knowledge record missing: ${id}`);
  }
  return record;
}

describe("committed generated knowledge", () => {
  test("keeps fixed and variable damage moves out of the status class", () => {
    const expected = new Map([
      ["dragon-rage", "special"],
      ["fissure", "physical"],
      ["night-shade", "physical"],
      ["seismic-toss", "physical"],
    ]);
    for (const [identifier, damageClass] of expected) {
      const record = requiredRecord(`battle:move:${identifier}`);
      expect(record.tags).toContain(damageClass);
      expect(record.tags).not.toContain("status");
      expect(record.body).toContain("Power: fixed or variable");
    }
  });

  test("uses field-specific move changelog history for Emerald values", () => {
    expect(requiredRecord("battle:move:vine-whip").body).toContain("Power: 35");
    expect(requiredRecord("battle:move:giga-drain").body).toContain(
      "Power: 60",
    );
  });

  test("labels the item catalog generation-wide and omits known FRLG items", () => {
    for (const identifier of CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS) {
      expect(recordsById.has(`items:${identifier}`)).toBe(false);
    }
    const pokeBall = requiredRecord("items:poke-ball");
    expect(pokeBall.body).toContain(
      "Generation III item identifier: poke-ball",
    );
    expect(pokeBall.body).toContain("does not prove the item is obtainable");
    expect(pokeBall.body).not.toContain("Emerald item identifier");
    expect(pokeBall.body).not.toContain("Shop cost:");
    expect(pokeBall.body).toContain("Price is omitted");
  });

  test("uses Emerald species forms, rarity, and evolution directions", () => {
    const deoxys = requiredRecord("species:deoxys");
    expect(deoxys.body).not.toContain(
      "Emerald level-up moves (level:move): none",
    );
    const mew = requiredRecord("species:mew");
    expect(mew.tags).toContain("mythical");
    expect(mew.tags).not.toContain("ordinary");
    const ralts = requiredRecord("species:ralts");
    expect(ralts.body).toContain("Evolves to: Kirlia");
    expect(ralts.body).toContain("level 20");
    const blissey = requiredRecord("species:blissey");
    expect(blissey.body).toContain("high friendship");
    const eevee = requiredRecord("species:eevee");
    expect(eevee.body).toContain("high friendship");
    const golbat = requiredRecord("species:golbat");
    expect(golbat.body).toContain("high friendship");
    const rayquaza = requiredRecord("species:rayquaza");
    expect(rayquaza.body).not.toContain("Capture rate:");
    const nincada = requiredRecord("species:nincada");
    expect(nincada.body).toContain(
      "Shedinja (Emerald special: when Nincada evolves at level 20, Shedinja is created alongside Ninjask only with an empty party slot; evidence: species:shedinja-creation-emerald)",
    );
    expect(nincada.body).not.toContain("Shedinja (Shed)");
    const shedinja = requiredRecord("species:shedinja");
    expect(shedinja.body).toContain(
      "Evolves from: Nincada (Emerald special: when Nincada evolves at level 20, Shedinja is created alongside Ninjask only with an empty party slot; evidence: species:shedinja-creation-emerald)",
    );
    expect(shedinja.body).not.toContain("Nincada (Shed)");
    const shedinjaCreation = requiredRecord(
      "species:shedinja-creation-emerald",
    );
    expect(shedinjaCreation.body).toContain("level-20 evolution");
    expect(shedinjaCreation.body).toContain(
      "leave at least one party slot empty",
    );
    const pokeApiSource: KnowledgeSource = {
      id: "pokeapi",
      url: `${sources.pokeapi.repository}/tree/${sources.pokeapi.commit}/${sources.pokeapi.csvPath}`,
      license: "BSD-3-Clause",
      revision: sources.pokeapi.commit,
    };
    const pokeemeraldSource: KnowledgeSource = {
      id: "pokeemerald-wasm",
      url: `${pokeemeraldUpstream.repository.replace(/\.git$/, "")}/tree/${pokeemeraldUpstream.commit}`,
      license: "No license declared",
      revision: pokeemeraldUpstream.commit,
    };
    expect(nincada.sources).toEqual([pokeApiSource, pokeemeraldSource]);
    expect(shedinja.sources).toEqual([pokeApiSource, pokeemeraldSource]);
    expect(shedinjaCreation.sources).toEqual([pokeemeraldSource]);
    const wurmple = requiredRecord("species:wurmple");
    expect(wurmple.body).toContain(
      "hidden upper personality value modulo 10 (0-4 produces Silcoon)",
    );
    expect(wurmple.body).toContain(
      "hidden upper personality value modulo 10 (5-9 produces Cascoon)",
    );
    const silcoon = requiredRecord("species:silcoon");
    expect(silcoon.body).toContain(
      "hidden upper personality value modulo 10 (0-4 produces Silcoon)",
    );
    const cascoon = requiredRecord("species:cascoon");
    expect(cascoon.body).toContain(
      "hidden upper personality value modulo 10 (5-9 produces Cascoon)",
    );
    const wurmpleBranch = requiredRecord(
      "species:wurmple-evolution-branch-emerald",
    );
    expect(wurmpleBranch.body).toContain("personality value modulo 10 is 0-4");
    expect(wurmple.sources).toEqual([pokeApiSource, pokeemeraldSource]);
    expect(silcoon.sources).toEqual([pokeApiSource, pokeemeraldSource]);
    expect(cascoon.sources).toEqual([pokeApiSource, pokeemeraldSource]);
    expect(wurmpleBranch.sources).toEqual([pokeemeraldSource]);
    for (const record of records.filter(
      (entry) => entry.domain === "species",
    )) {
      expect(record.body).not.toContain("Base experience:");
      expect(record.body).not.toContain("Capture rate:");
      expect(record.body).not.toMatch(/happiness \d+\+/);
    }
  });

  test("identifies Archipelago checks and logic as randomizer metadata", () => {
    const route = requiredRecord("world:region_route102/main");
    expect(route.body).toContain(
      "Archipelago randomizer check identifiers (not vanilla rewards)",
    );
    expect(route.body).toContain(
      "Archipelago randomizer logic identifiers (not vanilla events)",
    );
    expect(route.body).not.toContain("Locations and rewards:");
  });
});
