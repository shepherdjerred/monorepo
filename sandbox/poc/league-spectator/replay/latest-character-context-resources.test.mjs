import { describe, expect, test } from "bun:test";
import {
  compileCharacterContextResourceNames,
  bindSuppliedCharacterContextResource,
} from "./latest-character-context-resources.mjs";
import { projectSpellResourcePublication } from "./latest-spell-resource-publication.mjs";

describe("original static context/resource producers", () => {
  test("HealthRelic identifies the exact installed resolver without admitting it", () => {
    const names = compileCharacterContextResourceNames(
      "HA_AP_HealthRelic",
      0,
      "characters",
    );
    expect(names.contextIdentity).toBe(3143740604);
    expect(names.resourceIdentity).toBe(0x8ed45d52);
    expect(names.fileCandidates).toEqual([
      "DATA/characters/HA_AP_HealthRelic/Skins/Skin0.bin",
      "DATA/characters/HA_AP_HealthRelic/HA_AP_HealthRelic.bin",
    ]);
    expect(names.registryPublicationEstablished).toBe(false);
    expect(
      compileCharacterContextResourceNames("Arbitrary", 0xffffffff, "units")
        .fileCandidates,
    ).toBeNull();
    for (const value of [null, true, "0", -1, 1.5, 0x100000000])
      expect(() =>
        compileCharacterContextResourceNames("Any", value, "characters"),
      ).toThrow();
    for (const value of [null, "", "é", "Bad\0Name", "Has Space"])
      expect(() =>
        compileCharacterContextResourceNames(value, 0, "characters"),
      ).toThrow();
  });

  test("typed binding preserves null and exact rows with no readiness claim", () => {
    const names = compileCharacterContextResourceNames("Arbitrary", 0, "units");
    const result = {
      status: "supplied-original-typed-resource-query",
      resourceIdentity: names.resourceIdentity,
      found: true,
      typeHash: 0xef3a0f33,
      rows: [{ key: 1, referenceToken: 0 }],
    };
    const bound = bindSuppliedCharacterContextResource(names, result);
    result.rows[0].referenceToken = 99;
    expect(bound.rows).toEqual([{ key: 1, referenceToken: 0 }]);
    expect(bound.registryPublicationEstablished).toBe(false);
    expect(bound.linkedResourceAssets).toBe(false);
    expect(
      bindSuppliedCharacterContextResource(names, {
        ...result,
        found: false,
        typeHash: null,
        rows: [],
      }).status,
    ).toBe("supplied-character-context-null-resolver");
    expect(
      bindSuppliedCharacterContextResource(names, {
        ...result,
        typeHash: 0x23ea1915,
        rows: [],
      }).status,
    ).toBe("supplied-character-context-null-resolver");
    expect(() =>
      bindSuppliedCharacterContextResource(names, {
        ...result,
        typeHash: 0x72a165de,
      }),
    ).toThrow("untranslated");
    expect(() =>
      bindSuppliedCharacterContextResource(names, {
        ...result,
        rows: [
          { key: 1, referenceToken: 0 },
          { key: 1, referenceToken: 2 },
        ],
      }),
    ).toThrow();
  });

  test("ordered spell publication preserves duplicates, nulls and ownership", () => {
    const empty = { rows: [], sources: [], componentPublished: false };
    const result = projectSpellResourcePublication(
      empty,
      [
        {
          status: "supplied-resolved-resource-link",
          id: "first",
          rows: [
            { key: 2, referenceToken: 0 },
            { key: 3, referenceToken: 9 },
          ],
        },
        {
          status: "supplied-resolved-resource-link",
          id: "second",
          rows: [{ key: 2, referenceToken: 7 }],
        },
      ],
      "control:spell:1",
    );
    expect(result.rows).toEqual([
      { key: 2, referenceToken: 0 },
      { key: 2, referenceToken: 7 },
      { key: 3, referenceToken: 9 },
    ]);
    expect(result.sources.map((row) => row.resourceId)).toEqual([
      "first",
      "second",
    ]);
    expect(result.componentPublished).toBe(true);
    expect(
      projectSpellResourcePublication(empty, [], "control:empty")
        .componentPublished,
    ).toBe(false);
    expect(
      projectSpellResourcePublication(
        empty,
        [
          {
            status: "supplied-resolved-resource-link",
            id: "empty-map",
            rows: [],
          },
        ],
        "control:empty-map",
      ).componentPublished,
    ).toBe(true);
    expect(result.priorGlobalProducerHistoryRecovered).toBe(false);
    expect(result.assetRegistrationEstablished).toBe(false);
    expect(() =>
      projectSpellResourcePublication(
        empty,
        [{ status: "unresolved-resource-link", id: "unknown" }],
        "control:unknown",
      ),
    ).toThrow();
  });
});
