import { expect, test } from "bun:test";
import {
  readActorMetaNames,
  normalizeActorBin,
  findActorObject,
  validateActorRequest,
  actorUnsupportedDeclarations,
} from "./archived-actor-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import {
  selectActorAnimations,
  selectActorTexture,
  selectActorSkin,
} from "./archived-actor-plan.mjs";
import { createActorBinClosure } from "./archived-actor-closure.mjs";

const source = `
[MetaClassAttribute("Parent")]
public class Parent : IMetaClass {
 [MetaPropertyAttribute("TextureName", BinPropertyType.String)] public string A {get;set;}
}
[MetaClassAttribute("Child")]
public class Child : Parent {
 [MetaPropertyAttribute("mClipDataMap", BinPropertyType.Map)] public int B {get;set;}
}
[MetaClassAttribute(123U)]
public class Unknown : IMetaClass {
 [MetaPropertyAttribute("textureName", BinPropertyType.String)] public string C {get;set;}
}`;
const tree = (fields) => ({
  build: "16.21.829.8620",
  reader: "scout-exact-property-bin-16.21",
  objects: [
    {
      pathHash: mapBinHash("Characters/Test/Skins/Skin9"),
      classHash: mapBinHash("Child"),
      fields,
    },
  ],
});

test("recovers exact class-scoped field spellings and inheritance without injecting defaults", () => {
  const names = readActorMetaNames(source);
  expect(names.fieldName(mapBinHash("Child"), mapBinHash("TextureName"))).toBe(
    "TextureName",
  );
  expect(names.fieldName("0000007b", mapBinHash("TextureName"))).toBe(
    "textureName",
  );
  const normalized = normalizeActorBin(
    tree({
      [mapBinHash("TextureName")]: { type: "String", value: "original.tex" },
      "01020304": { type: "F32", value: 2 },
    }),
    names,
    ["Characters/Test/Skins/Skin9"],
  );
  expect(
    findActorObject(
      normalized,
      `{${mapBinHash("Characters/Test/Skins/Skin9")}}`,
    ),
  ).toEqual({ __type: "Child", TextureName: "original.tex", "{01020304}": 2 });
});

test("retains exact hashed map keys and wide asset references, preserving duplicate declarations losslessly", () => {
  const names = readActorMetaNames(source);
  const property = {
    type: "Map",
    entries: [
      {
        key: { type: "Hash", value: 42 },
        value: { type: "WadChunkLink", value: "18446744073709551615" },
      },
    ],
  };
  const normalized = normalizeActorBin(
    tree({ [mapBinHash("mClipDataMap")]: property }),
    names,
  );
  expect(Object.values(normalized)[0].mClipDataMap).toEqual({
    "{0000002a}": { kind: "wad-path-hash", value: "18446744073709551615" },
  });
  property.entries.push(property.entries[0]);
  const opaque = normalizeActorBin(
    tree({ [mapBinHash("mClipDataMap")]: property }),
    names,
  );
  const declaration = Object.values(opaque)[0].mClipDataMap;
  expect(declaration).toMatchObject({
    __type: "UnresolvedOriginalBinMap",
    reason: "duplicate-original-map-keys",
    original: property,
  });
  expect(declaration.original).not.toBe(property);
  expect(declaration.original.entries).toHaveLength(2);
  expect(actorUnsupportedDeclarations(opaque)).toEqual([
    {
      path: [Object.keys(opaque)[0], "mClipDataMap"],
      reason: "duplicate-original-map-keys",
      entries: 2,
    },
  ]);
  expect(() =>
    selectActorAnimations({
      graph: { __type: "AnimationGraphData", mClipDataMap: declaration },
    }),
  ).toThrow("Original actor graph has no supported atomic animation resources");
});

test("native map policy receives exact original owner and nested field address without replacing unknown maps", () => {
  const names = readActorMetaNames(source),
    seen = [];
  const duplicate = {
    type: "Map",
    entries: [0, 1].map(() => ({
      key: { type: "Hash", value: 42 },
      value: { type: "String", value: "original" },
    })),
  };
  const original = tree({
    "01020304": {
      type: "Container",
      elements: [
        {
          type: "Struct",
          classHash: "0000007b",
          fields: { 11223344: duplicate },
        },
      ],
    },
  });
  original.sourceSha256 = "a".repeat(64);
  const normalized = normalizeActorBin(
    original,
    names,
    [],
    (opaque, context) => {
      seen.push(context);
      return { "native-selected-row": opaque.entries[1].value };
    },
  );
  expect(seen).toEqual([
    {
      sourceBinSha256: "a".repeat(64),
      ownerPath: original.objects[0].pathHash,
      trail: ["fields", "01020304", "elements", 0],
      classHash: "0000007b",
      fieldHash: "11223344",
    },
  ]);
  expect(actorUnsupportedDeclarations(normalized)).toEqual([]);
  expect(Object.values(normalized)[0]["{01020304}"][0]["{11223344}"]).toEqual({
    "native-selected-row": "original",
  });
  const unknown = normalizeActorBin(original, names, [], () => undefined);
  expect(actorUnsupportedDeclarations(unknown)).toHaveLength(1);
  expect(duplicate.entries).toHaveLength(2);
});

test("requires explicit skin selections and rejects guessed or duplicate requests", () => {
  const request = {
    schema: 1,
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    actors: [
      {
        character: "AnyCharacter",
        skinId: 27,
        role: "champion",
        characterRecords: [],
      },
    ],
  };
  expect(validateActorRequest(request)[0].key).toBe("anycharacter/27");
  expect(() =>
    validateActorRequest({
      ...request,
      actors: [{ ...request.actors[0], skinId: undefined }],
    }),
  ).toThrow("Invalid archived actor");
  expect(() =>
    validateActorRequest({
      ...request,
      actors: [...request.actors, ...request.actors],
    }),
  ).toThrow("Duplicate archived actor");
  expect(() =>
    validateActorRequest({ ...request, build: "16.22.834.8910" }),
  ).toThrow("Exact 16.21");
});

test("selects the requested original skin only and never substitutes an absent texture", () => {
  const actor = { character: "Test", skinId: 9, key: "test/9" };
  const skin = {
    __type: "SkinCharacterDataProperties",
    skinMeshProperties: {
      simpleSkin: "original.skn",
      skeleton: "original.skl",
    },
  };
  expect(
    selectActorSkin({ "Characters/Test/Skins/Skin9": skin }, actor).mesh,
  ).toEqual(skin.skinMeshProperties);
  expect(() =>
    selectActorSkin({ "Characters/Test/Skins/Skin0": skin }, actor),
  ).toThrow("Unique archived actor object");
  expect(() =>
    selectActorTexture({
      skin,
      mesh: skin.skinMeshProperties,
      range: "body",
      objects: [],
    }),
  ).toThrow("Original actor texture is absent");
  expect(() =>
    selectActorTexture({
      skin,
      mesh: { texture: "base.tex", Material: "OriginalMaterial" },
      range: "body",
      objects: [],
    }),
  ).toThrow("Unresolved original actor material");
});

test("prepares arbitrary exact atomic resources without inventing named clips", () => {
  const graph = {
    "{00000001}": {
      __type: "AnimationGraphData",
      mClipDataMap: {
        "{00000002}": {
          __type: "AtomicClipData",
          mAnimationResourceData: {
            mAnimationFilePath: "assets/any/Original_Action.anm",
          },
        },
        "{00000003}": {
          __type: "AtomicClipData",
          mAnimationResourceData: {
            mAnimationFilePath: "assets/any/Original_Action.anm",
          },
        },
      },
    },
  };
  const plan = selectActorAnimations(graph);
  expect(plan.files).toHaveLength(1);
  expect(plan.selected).toEqual({
    "{00000002}": "animations/0.anm",
    "{00000003}": "animations/0.anm",
  });
  expect(plan.previewClips.idle).toBeNull();
  expect(plan.previewClips.run).toBeNull();
  graph["{00000001}"].mClipDataMap[
    "{00000002}"
  ].mAnimationResourceData.mAnimationFilePath = {
    kind: "wad-path-hash",
    value: "18446744073709551615",
  };
  const hashed = selectActorAnimations(graph);
  expect(hashed.files).toHaveLength(2);
  expect(hashed.files[0].reference).toEqual({
    kind: "wad-path-hash",
    value: "18446744073709551615",
  });
  expect(hashed.previewClips.idle).toBeNull();
});

test("inventories all duplicate-key animation resources without choosing an active native clip", () => {
  const entries = ["original/Idle1.anm", "original/Other.anm"].map(
    (reference, sourceEntry) => ({
      key: "{c21e3b46}",
      sourceEntry,
      value: {
        __type: "AtomicClipData",
        mAnimationResourceData: { mAnimationFilePath: reference },
      },
    }),
  );
  const graph = {
    graph: {
      __type: "AnimationGraphData",
      mClipDataMap: {
        __type: "UnresolvedOriginalBinMap",
        reason: "duplicate-original-map-keys",
        entries,
      },
    },
  };
  const snapshot = structuredClone(graph);
  const plan = selectActorAnimations(graph);
  expect(plan.selected).toEqual({
    "{c21e3b46}@entry-0": "animations/0.anm",
    "{c21e3b46}@entry-1": "animations/1.anm",
  });
  expect(plan.lookupStatus).toBe(
    "unsupported-original-duplicate-key-semantics",
  );
  expect(plan.previewClips.idle).toBeNull();
  expect(plan.clipSources["{c21e3b46}@entry-1"]).toEqual({
    originalKey: "{c21e3b46}",
    sourceEntry: 1,
    reference: "original/Other.anm",
  });
  expect(graph).toEqual(snapshot);
});

test("resolves links only through declared original BIN dependencies and verifies the object", async () => {
  const graphPath = "Characters/Test/Animations/Skin9";
  const hash = mapBinHash(graphPath),
    seen = [];
  const graph = {
    pathHash: hash,
    classHash: mapBinHash("AnimationGraphData"),
    fields: {},
  };
  const source = {
    async bin(_wad, file) {
      seen.push(file);
      return file.endsWith("skin9.bin")
        ? {
            tree: {
              dependencies: ["data/unrelated.bin", `data/${graphPath}.bin`],
              objects: [],
            },
            normalized: {},
          }
        : {
            tree: { dependencies: [], objects: [graph] },
            normalized: { [`{${hash}}`]: { __type: "AnimationGraphData" } },
          };
    },
  };
  const closure = createActorBinClosure(source, "original.wad.client");
  await closure.load("data/skin9.bin");
  expect((await closure.resolve(`{${hash}}`)).value.__type).toBe(
    "AnimationGraphData",
  );
  expect(seen).toEqual(["data/skin9.bin", `data/${graphPath}.bin`]);
  await expect(closure.resolve("Missing/OriginalObject")).rejects.toThrow(
    "Missing original actor dependency object",
  );
});

test("rejects conflicting duplicate objects instead of merging a different dependency version", async () => {
  const original = { pathHash: "00000001", classHash: "00000002", fields: {} };
  const source = {
    async bin(_wad, file) {
      return {
        tree: {
          dependencies: [],
          objects: [
            {
              ...original,
              classHash: file === "first.bin" ? "00000002" : "00000003",
            },
          ],
        },
        normalized: { "{00000001}": { __type: "Unknown" } },
      };
    },
  };
  const closure = createActorBinClosure(source, "original.wad.client");
  await closure.load("first.bin");
  await closure.load("second.bin");
  expect(() => closure.objects()).toThrow("Conflicting original actor object");
});
