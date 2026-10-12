import { describe, expect, test } from "vitest";
import { arenaAugmentCache } from "./arena-augments.ts";
import { getCachedAugmentNameById } from "./augment-names.ts";
import { AugmentNameCatalogSchema } from "./augment-names-schema.ts";

describe("pinned recorded augment names", () => {
  test("preserves every name in the detailed Arena cache", () => {
    for (const augment of Object.values(arenaAugmentCache)) {
      expect(getCachedAugmentNameById(augment.id)).toBe(augment.name);
    }
  });

  test.each([
    [71, "Scopier Weapons"],
    [250, "Slow and Steady"],
    [374, "Rice and Chicken"],
    [2008, "Weighted Popoffs"],
    [7001, "Upgrade: Zz'Rot Portal"],
  ])("resolves recorded augment %i", (id, name) => {
    expect(getCachedAugmentNameById(id)).toBe(name);
  });

  test("does not invent a name for an unknown ID", () => {
    expect(getCachedAugmentNameById(999_999_999)).toBeUndefined();
  });

  test("rejects corrupt generated assets", () => {
    const valid = {
      sourceVersions: ["16.19"],
      augments: {
        "71": { apiName: "ScopierWeapons", name: "Scopier Weapons" },
      },
    };
    expect(AugmentNameCatalogSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, sourceVersions: ["latest"] },
      { ...valid, sourceVersions: ["16.19", "16.19"] },
      { ...valid, augments: {} },
      { ...valid, augments: { invalid: valid.augments["71"] } },
      { ...valid, augments: { "71": { apiName: "", name: "Name" } } },
    ]) {
      expect(AugmentNameCatalogSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
