import { dareValueDomainCatalog } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";

describe("Dare authoring value-domain catalog", () => {
  // The model had no source of truth for these values anywhere — not the
  // prompt, not a tool description, not the JSON Schema. It inferred them, which
  // is how `team_position = 'MID'` reached three funded contracts.
  const catalog = dareValueDomainCatalog();

  test("publishes the lane values Riot actually records", () => {
    expect(catalog["team_position"]).toEqual([
      "TOP",
      "JUNGLE",
      "MIDDLE",
      "BOTTOM",
      "UTILITY",
    ]);
  });

  test("does not publish the spellings the model invented", () => {
    expect(catalog["team_position"]).not.toContain("MID");
    expect(catalog["team_position"]).not.toContain("SUPPORT");
    expect(catalog["event_type"]).not.toContain("DRAGON_KILL");
  });

  test("publishes the objective discriminators", () => {
    expect(catalog["monster_type"]).toContain("DRAGON");
    expect(catalog["monster_type"]).toContain("BARON_NASHOR");
    expect(catalog["building_type"]).toContain("TOWER_BUILDING");
  });

  // ~170 champion keys is not a useful thing to recite at an author, and the
  // registry resolves display names anyway.
  test("omits champions, which are resolved rather than listed", () => {
    expect(Object.keys(catalog)).not.toContain("champion_name");
  });
});
