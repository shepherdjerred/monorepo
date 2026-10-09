import { describe, expect, test } from "vitest";
import { buildAugmentNameCatalog } from "./augment-names.ts";

const historical = {
  id: 71,
  augmentNameId: "ScopierWeapons",
  nameTRA: "Scopier Weapons",
};
const current = {
  id: 2008,
  augmentNameId: "ARAM_WeightedPopoffs",
  nameTRA: "Weighted Popoffs",
};

describe("augment-name generation", () => {
  test("retains removed IDs and includes names outside the detailed Arena catalog", () => {
    expect(
      buildAugmentNameCatalog([
        { version: "16.19", data: [historical] },
        { version: "16.20", data: [current] },
      ]),
    ).toEqual({
      sourceVersions: ["16.19", "16.20"],
      augments: {
        "71": { apiName: "ScopierWeapons", name: "Scopier Weapons" },
        "2008": { apiName: "ARAM_WeightedPopoffs", name: "Weighted Popoffs" },
      },
    });
  });

  test("uses the current name when the identity is unchanged", () => {
    const catalog = buildAugmentNameCatalog([
      { version: "16.19", data: [historical] },
      {
        version: "16.20",
        data: [{ ...historical, nameTRA: "Updated display name" }],
      },
    ]);
    expect(catalog.augments["71"]?.name).toBe("Updated display name");
  });

  test("rejects conflicting identities instead of relabeling history", () => {
    expect(() =>
      buildAugmentNameCatalog([
        { version: "16.19", data: [historical] },
        {
          version: "16.20",
          data: [{ ...historical, augmentNameId: "DifferentAugment" }],
        },
      ]),
    ).toThrow("Conflicting augment identity: 71");
  });

  test("rejects duplicate IDs even with identical metadata", () => {
    expect(() =>
      buildAugmentNameCatalog([{ version: "16.19", data: [current, current] }]),
    ).toThrow("Duplicate augment ID: 2008");
  });

  test("rejects duplicate snapshot versions", () => {
    expect(() =>
      buildAugmentNameCatalog([
        { version: "16.19", data: [historical] },
        { version: "16.19", data: [current] },
      ]),
    ).toThrow("Duplicate augment snapshot version");
  });

  test.each([
    { ...current, id: 0 },
    { ...current, id: 1.5 },
    { ...current, augmentNameId: " " },
    { ...current, nameTRA: "" },
    { ...current, nameTRA: " " },
  ])("rejects malformed upstream metadata: %j", (invalid) => {
    expect(() =>
      buildAugmentNameCatalog([{ version: "16.19", data: [invalid] }]),
    ).toThrow();
  });

  test("rejects empty catalogs and invalid version provenance", () => {
    expect(() => buildAugmentNameCatalog([])).toThrow();
    expect(() =>
      buildAugmentNameCatalog([{ version: "16.19", data: [] }]),
    ).toThrow();
    expect(() =>
      buildAugmentNameCatalog([{ version: "latest", data: [current] }]),
    ).toThrow();
  });
});
