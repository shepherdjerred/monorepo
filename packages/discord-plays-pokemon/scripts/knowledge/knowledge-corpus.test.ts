import { describe, expect, test } from "bun:test";
import { KnowledgeRecordsSchema } from "./model.ts";
import { CONFIRMED_FRLG_ONLY_ITEM_IDENTIFIERS } from "./pokeapi.ts";

const packageRoot = new URL("../..", import.meta.url).pathname;
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
