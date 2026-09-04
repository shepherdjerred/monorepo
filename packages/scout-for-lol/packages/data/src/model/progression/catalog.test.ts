import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import catalog from "#competitive-progression-catalog" with { type: "json" };
import catalogJsonSchema from "#competitive-progression-catalog-schema" with { type: "json" };
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  CompetitiveProgressionCatalogSchema,
  DEFAULT_HALL_QUEUE_FAMILIES,
} from "./catalog.ts";

describe("competitive progression catalog", () => {
  test("is valid under both the runtime and language-neutral schemas", () => {
    expect(CompetitiveProgressionCatalogSchema.parse(catalog)).toEqual(catalog);
    const validate = new Ajv2020({ strict: true }).compile(catalogJsonSchema);
    expect(validate(catalog), JSON.stringify(validate.errors)).toBe(true);
  });

  test("preselects the four intended queue families", () => {
    expect(DEFAULT_HALL_QUEUE_FAMILIES).toEqual([
      "ranked_sr",
      "unranked_sr",
      "aram",
      "arena",
    ]);
    expect(
      COMPETITIVE_PROGRESSION_CATALOG.hall.records.map((record) => record.id),
    ).toHaveLength(18);
  });
});
