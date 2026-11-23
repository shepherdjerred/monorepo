import { expect, test } from "bun:test";
import { findArchivedActorObjects } from "./archived-actor-object-search.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
const reference = "Characters/Exact/Skins/Skin3",
  target = { reference, className: "SkinCharacterDataProperties" };
function fixture() {
  const objects = [
    {
      pathHash: mapBinHash(reference),
      classHash: mapBinHash(target.className),
      fields: {},
    },
  ];
  const bins = new Map([
    [
      "character.bin",
      {
        tree: { dependencies: ["actual-owner.bin"], objects: [] },
        normalized: {},
      },
    ],
    [
      "actual-owner.bin",
      {
        tree: { dependencies: [], objects },
        normalized: { [reference]: { __type: target.className } },
      },
    ],
    [
      "skin0.bin",
      {
        tree: {
          dependencies: [],
          objects: [
            {
              ...objects[0],
              pathHash: mapBinHash("Characters/Exact/Skins/Skin0"),
            },
          ],
        },
        normalized: {},
      },
    ],
  ]);
  return {
    bins,
    archive: { has: (path) => bins.has(path) },
    source: { bin: async (_, file) => bins.get(file) },
  };
}
test("object namespace resolves through declared dependencies to its actual physical owner", async () => {
  const result = await findArchivedActorObjects({
    ...fixture(),
    wad: "exact",
    seeds: ["character.bin"],
    targets: [target],
  });
  expect(result.found.get(mapBinHash(reference)).file).toBe("actual-owner.bin");
  expect(result.unresolved).toEqual([]);
});
test("an existing skin0 never substitutes for the absent requested skin object", async () => {
  const result = await findArchivedActorObjects({
    ...fixture(),
    wad: "exact",
    seeds: ["missing-skin3.bin", "skin0.bin"],
    targets: [target],
  });
  expect(result.found.size).toBe(0);
  expect(result.unresolved[0].reference).toBe(reference);
  expect(result.missing).toEqual(["missing-skin3.bin"]);
});
test("conflicting owners or wrong original classes reject instead of choosing one", async () => {
  const first = fixture();
  first.bins.get("actual-owner.bin").tree.objects[0].classHash = "00000000";
  await expect(
    findArchivedActorObjects({
      ...first,
      wad: "exact",
      seeds: ["character.bin"],
      targets: [target],
    }),
  ).rejects.toThrow("class mismatch");
  const second = fixture(),
    duplicate = structuredClone(second.bins.get("actual-owner.bin"));
  duplicate.tree.objects[0].fields = { different: true };
  second.bins.set("other.bin", duplicate);
  await expect(
    findArchivedActorObjects({
      ...second,
      wad: "exact",
      seeds: ["character.bin", "other.bin"],
      targets: [target],
    }),
  ).rejects.toThrow("Conflicting");
});
