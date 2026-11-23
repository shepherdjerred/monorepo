export const SCENE_EFFECT_IDENTITY_V2 = Object.freeze({
  seedText: "[Character]",
  multiplier: 0x1003f,
  order: Object.freeze(["name", "skinUnsignedDecimal", "namespace"]),
  hashRva: 0x1442120,
  appendRva: 0x14371c0,
  constructorPrefix: Object.freeze([0x351910, 0x3519e7]),
  identityFragment: Object.freeze([0x351af4, 0x351b46]),
  registryLookupRva: 0x354280,
});
export const SCENE_EFFECT_LOOKUP_V2 = Object.freeze({
  rva: 0x16153d0,
  auxiliaryChainRva: 0x377890,
  unresolvedGlobalStageRva: 0x377a2d,
  order: "first-present-key-in-vector-order",
  nullReferenceIsPresent: true,
});
// A distinct recipe for exact archived fields and source-bound appearance
// aliases. It does not replace the retained schema-1 program fingerprints.
export const SCENE_EFFECT_RESOURCE_RECIPE_V2 =
  "original-scene-effect-resources-v2";
export const SCENE_EFFECT_RESOURCE_RECIPE_V3 =
  "original-scene-effect-resources-v3-case-source-witnesses";
export const SCENE_EFFECT_RESOURCE_FINGERPRINTS_V3 = Object.freeze({
  preparer: "8e225121f6256e3ee194aba270816f464e2fe58acff0763893a2717b105d81f8",
  inputPreparer:
    "7362668d7df2cace0b6313f0d7fd88245cb99c4aec7fba06e3f1b25f21d86070",
  inputSources:
    "c881937b99aff0147d016732f9e1e7347c05a6268a488f2abdac6343b26116a8",
  contexts: "677d70331fb078073f2991378ac9978f730b4836f0388962e103a44bbcce1aca",
  resolvers: "2afae8dffefc3f153fc7f8b73d3cb36db8b9d9a4a69a8f00a81ae0d1cbf52706",
});
export const SCENE_EFFECT_RESOURCE_FINGERPRINTS_V2 = Object.freeze({
  preparer: "584caa1457b86320556ab296574e71a84be6c9c5e009f2857508f93283020348",
  inputPreparer:
    "a31625f1f5f2c920844786ebd19a3597ededae26c28a7268ee979dfafd583d34",
  inputSources:
    "17a757ce1e77bd0c877f92d2ac2d23187c8ed403052fa6600ee94826ebc8f27f",
  contexts: "5ef85e703315fb61cbe26d69fb960e107a170bc0bf444d237fb88cdf73c83fa6",
  resolvers: "c324e0542a7cac1f98913b0ec60ff0f28d093194a1b1e4554aa4b836c695729d",
});
