import { expect, test } from "bun:test";
import {
  createArchivedFxObjectIndex,
  compileArchivedFxActor,
} from "./archived-fx-bindings.mjs";

const actor = {
    "Characters/Test/Skins/Skin7": {
      __type: "SkinCharacterDataProperties",
      mResourceResolver: "resolver",
    },
    resolver: {
      __type: "ResourceResolver",
      resourceMap: { effect: "vfx", empty: "{00000000}" },
    },
    vfx: {
      __type: "VfxSystemDefinitionData",
      complexEmitterDefinitionData: [],
    },
    spell: { __type: "SpellObject", mSpell: { mMissileEffectKey: "effect" } },
  },
  spell = {
    name: "spell",
    path: "spell",
    hash: 42,
    data: { mMissileEffectKey: "effect" },
  },
  bins = [
    { file: "skin7.bin", wad: "Test", sourceSha256: "a", normalized: actor },
  ];
test("exact selected skin resolver joins original missile key without inventing activation", () => {
  const result = compileArchivedFxActor({
    character: "Test",
    skinId: 7,
    index: createArchivedFxObjectIndex(bins),
    spells: { spell },
  });
  expect(result.missiles[42].status).toBe("prepared-definition");
  expect(result.unresolved).toHaveLength(0);
  expect(Object.values(result.resources).map((row) => row.status)).toEqual([
    "prepared-definition",
    "null-object-link",
  ]);
});
test("conflicting original definitions remain unresolved rather than selecting archive order", () => {
  const index = createArchivedFxObjectIndex([
    ...bins,
    {
      file: "other.bin",
      wad: "Other",
      sourceSha256: "b",
      normalized: { vfx: { __type: "VfxSystemDefinitionData", changed: true } },
    },
  ]);
  expect(index.select("vfx").status).toBe(
    "unsupported-original-object-precedence",
  );
  const result = compileArchivedFxActor({
    character: "Test",
    skinId: 7,
    index,
    spells: { spell },
  });
  expect(result.missiles[42].status).toBe("unprepared");
  expect(result.unresolved[0].candidates).toHaveLength(2);
});
test("source/catalog disagreement and missing exact skin reject", () => {
  const index = createArchivedFxObjectIndex(bins);
  expect(() =>
    compileArchivedFxActor({ character: "Test", skinId: 0, index, spells: {} }),
  ).toThrow("unresolved");
  expect(() =>
    compileArchivedFxActor({
      character: "Test",
      skinId: 7,
      index,
      spells: { spell: { ...spell, data: { mMissileEffectKey: "different" } } },
    }),
  ).toThrow("differs");
});
