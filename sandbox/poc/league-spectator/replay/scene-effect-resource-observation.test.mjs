import { expect, test } from "bun:test";
import { validateSceneEffectAliases } from "./scene-effect-resource-observation.mjs";
function fixture() {
  const source = {
      character: "Neutral",
      skinId: 3,
      skinSha256: "a".repeat(64),
      wad: "map11",
      sourceRows: [{ file: "data/neutral.bin", sha256: "b".repeat(64) }],
      resolverId: 7,
      resolverSourceSha256: "b".repeat(64),
      resolverPathHash: "00000007",
      resolverClassHash: "ef3a0f33",
      rows: [{ key: 9, referenceToken: 12 }],
    },
    context = {
      actorKey: "world/neutral/3",
      actorAliases: ["world/neutral/3", "world/duplicate/3"],
      name: "Neutral",
      skinId: 3,
      namespace: "characters",
      identity: 99,
      resourceResolverId: "{00000007}",
      sourceIdentity: source,
    },
    asset = {
      character: "Neutral",
      skinId: 3,
      source: {
        skinSha256: source.skinSha256,
        wad: "Map11",
        bins: [
          { path: "data/neutral.bin", sha256: source.sourceRows[0].sha256 },
        ],
      },
    },
    actor = {
      character: "Neutral",
      skinId: 3,
      resourceResolverId: "{00000007}",
      resources: { "00000009": { reference: "{0000000c}" } },
    };
  return {
    contexts: [context],
    effects: {
      actors: {
        "world/neutral/3": structuredClone(actor),
        "world/duplicate/3": structuredClone(actor),
      },
    },
    inputs: {
      schema: 2,
      kind: "original-scene-effect-resource-inputs",
      nativeSpectatorAdmitted: false,
      contexts: [structuredClone(context)],
      appearances: 2,
    },
    scene: { champions: {} },
    world: {
      assets: {
        "neutral/3": structuredClone(asset),
        "duplicate/3": structuredClone(asset),
      },
    },
  };
}
test("identical original appearance sources can alias one native context", () => {
  expect(validateSceneEffectAliases(fixture())).toEqual({
    appearances: 2,
    canonicalContexts: 1,
    aliases: 1,
  });
});
test("case-aware aliases retain each original spelling and all source witnesses", () => {
  const value = fixture(),
    context = value.contexts[0];
  value.inputs.aliasIdentityPolicy =
    "original-ascii-case-insensitive-namespace-with-complete-per-alias-source-witness";
  context.aliasSources = context.actorAliases.map((actorKey, index) => ({
    actorKey,
    name: index ? "neutral" : "Neutral",
    sourceIdentity: {
      ...structuredClone(context.sourceIdentity),
      character: index ? "neutral" : "Neutral",
    },
  }));
  value.effects.actors["world/duplicate/3"].character = "neutral";
  value.world.assets["duplicate/3"].character = "neutral";
  value.inputs.contexts[0].aliasSources = structuredClone(context.aliasSources);
  expect(validateSceneEffectAliases(value).aliases).toBe(1);
  context.aliasSources[1].sourceIdentity.skinSha256 = "c".repeat(64);
  value.inputs.contexts[0].aliasSources = structuredClone(context.aliasSources);
  expect(() => validateSceneEffectAliases(value)).toThrow(
    "original appearance/resolver sources",
  );
});
test("matching names and skins cannot hide changed raw sources or resource rows", () => {
  for (const mutate of [
    (value) => {
      value.world.assets["duplicate/3"].source.skinSha256 = "c".repeat(64);
    },
    (value) => {
      value.world.assets["duplicate/3"].source.bins[0].sha256 = "c".repeat(64);
    },
    (value) => {
      value.effects.actors["world/duplicate/3"].resources[
        "00000009"
      ].reference = "{0000000d}";
    },
    (value) => {
      value.effects.actors["world/duplicate/3"].resourceResolverId =
        "{00000008}";
    },
    (value) => {
      value.world.assets["duplicate/3"].source.wad = "OtherArchive";
    },
  ]) {
    const value = fixture();
    mutate(value);
    expect(() => validateSceneEffectAliases(value)).toThrow(
      "original appearance/resolver sources",
    );
  }
});
test("omitted and duplicate aliases reject instead of dropping an appearance", () => {
  const omitted = fixture();
  omitted.contexts[0].actorAliases.pop();
  omitted.inputs.contexts[0].actorAliases.pop();
  expect(() => validateSceneEffectAliases(omitted)).toThrow("coverage");
  const duplicate = fixture();
  duplicate.contexts[0].actorAliases[1] = duplicate.contexts[0].actorAliases[0];
  duplicate.inputs.contexts[0].actorAliases = [
    ...duplicate.contexts[0].actorAliases,
  ];
  expect(() => validateSceneEffectAliases(duplicate)).toThrow(
    "original appearance/resolver sources",
  );
});
