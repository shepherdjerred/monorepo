import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { createLatestDirectRayMaterials } from "../latest-direct-ray-materials.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Ray material preparation input changed");
  inputs[path] = hash;
  return value;
}
await captureDirectSourceInputs([import.meta.path], raw);
const loadBytes = (path) => raw(`${cache}/public/${path}`),
  profile = JSON.parse(
    new TextDecoder().decode(
      await loadBytes("decoder-16.21-macos/profile.json"),
    ),
  ),
  nativePackageBytes = await loadBytes(
    "latest-parent-native-materials/package.json",
  ),
  effectsManifestBytes = await loadBytes("latest-effects/manifest.json"),
  bridge = await createLatestDirectRayMaterials({
    profile,
    nativePackageBytes,
    effectsManifestBytes,
  });
const bindings = [],
  unresolved = [],
  inventory = bridge.inventory();
let loadedVariants = 0,
  retainedSceneRequirements = 0,
  firstPrepared;
for (const emitter of inventory)
  for (const pass of emitter.passes)
    for (let variantIndex = 0; variantIndex < pass.variants; variantIndex++) {
      const prepared = await bridge.prepare({
        ...emitter,
        passHash: pass.hash,
        variantIndex,
        loadBytes,
      });
      if (prepared.status !== "prepared-direct-ray-material")
        throw Error("Captured exact native Ray pass missing");
      firstPrepared ??= prepared;
      const missing = bridge.bind(prepared, {});
      if (
        missing.status !== "unresolved-ray-scene-inputs" ||
        !missing.omissions.length
      )
        throw Error("Scene resources silently supplied");
      bindings.push(prepared.manifest);
      unresolved.push({
        effectId: emitter.effectId,
        emitterIndex: emitter.emitterIndex,
        passHash: pass.hash,
        variantIndex,
        omissions: missing.omissions,
      });
      retainedSceneRequirements += missing.omissions.length;
      loadedVariants++;
    }
// These explicit diagnostic inputs exercise the usable binding seam. They are
// never stored as assets, substituted during preparation, or match admission.
const sample = inventory[0],
  passHash = sample.passes[0].hash,
  query = { ...sample, passHash, variantIndex: 0, loadBytes };
assert.throws(
  () => bridge.bind(structuredClone(firstPrepared), {}),
  /Owned prepared/,
);
assert.equal(
  (await bridge.prepare({ ...query, passHash: 0 })).status,
  "unavailable-native-material-pass",
);
await assert.rejects(() => bridge.prepare({ ...query, variantIndex: 999 }));
await assert.rejects(
  () =>
    bridge.prepare({
      ...query,
      loadBytes: async (path) => {
        const value = await loadBytes(path);
        if (!path.startsWith("latest-shaders/")) return value;
        const corrupt = value.slice();
        corrupt[0] ^= 1;
        return corrupt;
      },
    }),
  /shader integrity/,
);
const uniforms = {
  mProj: new Uint8Array(
    Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).buffer,
  ),
  vCamera: new Uint8Array(Float32Array.from([0, 1000, 0, 0]).buffer),
  FOG_OF_WAR_PARAMS: new Uint8Array(Float32Array.from([0, 0, 0.5, 0.5]).buffer),
  RENDERTARGET_IS_SRGB: new Uint8Array(16),
};
const diagnosticScene = {
  uniforms,
  textures: Object.fromEntries(
    firstPrepared.manifest.requiredScene.textures.map((t) => [
      t.name,
      {
        dimension: "texture2d",
        width: 1,
        height: 1,
        rgba: new Uint8Array(
          t.name === "FOW_MAP_SharedTexture"
            ? [255, 255, 255, 255]
            : [0, 0, 0, 0],
        ),
        samplerDescriptorHex: "01010100000000000000000100000000",
        samplerParameters: {
          10240: 9729,
          10241: 9729,
          10242: 33071,
          10243: 33071,
        },
        inputPolicy: "explicit-unit-binding-control-no-match-scene-claim",
      },
    ]),
  ),
  stencilReference: 0,
  blendColor: [0, 0, 0, 0],
};
const bound = bridge.bind(firstPrepared, diagnosticScene);
assert.equal(bound.status, "bound-explicit-scene-ray-material");
assert.equal(bound.uniforms.length, 4);
const originalVertexStage = bound.stages[0];
bound.stages[0] = null;
assert.equal(
  bridge.bind(firstPrepared, diagnosticScene).stages[0],
  originalVertexStage,
);
const retainedByte = bound.textures[0].levels[0][0][0];
bound.textures[0].levels[0][0][0] ^= 255;
assert.equal(
  bridge.bind(firstPrepared, diagnosticScene).textures[0].levels[0][0][0],
  retainedByte,
);
assert.notEqual(
  bound.sceneTextures.FOW_MAP_SharedTexture.rgba.buffer,
  diagnosticScene.textures.FOW_MAP_SharedTexture.rgba.buffer,
);
const output = resolve(cache, "research/direct-ray-materials/package.json");
const result = {
  schema: 1,
  kind: "prepared-direct-ray-material-resource-bridge",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  decoderImageSha256: profile.decoderImageSha256,
  inputs,
  inventory,
  bindings,
  unresolved,
  counts: {
    emitters: inventory.length,
    variants: loadedVariants,
    retainedSceneRequirements,
  },
  controls: {
    foreignPreparedHandleRejected: true,
    unavailablePassIsTyped: true,
    unknownVariantRejected: true,
    corruptedShaderRejected: true,
    explicitDiagnosticSceneBound: true,
    frameBlocksPacked: bound.uniforms.length,
    independentStaticAndSceneTextureBytes: true,
    independentStageArray: true,
    gpuExecuted: false,
  },
  scope: {
    staticBuildAndAssetResourcesOnly: true,
    explicitNativePassesAndVariants: true,
    sceneResourcesSupplied: false,
    perFrameGuestInstructions: 0,
    replayPlacementOrMotionSupplied: false,
    runtimeAdmissionChanged: false,
    gpuSubmitted: false,
  },
};
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Final ray material input drift");
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    ...result.counts,
    fingerprints: Object.keys(inputs).length,
  }),
);
