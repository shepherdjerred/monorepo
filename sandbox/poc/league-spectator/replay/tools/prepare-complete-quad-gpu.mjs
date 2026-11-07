// GPU bindings for complete camera/arbitrary quads, including continuous and
// randomized emitters. Unsupported resources stay explicit in the inventory.
import { resolve } from "node:path";
import { createLatestVfxMaterials } from "../latest-vfx-materials.mjs";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createSelectedNativeMaterialInventory } from "../latest-selected-vfx-material-inventory.mjs";
import {
  prepareNativeParticleGpuBinding,
  nativeParticleGpuOmissions,
} from "./particle-gpu-bindings.mjs";
const [arg, ...options] = process.argv.slice(2),
  references = new Map();
if (!arg || options.length % 2 || options.length > 4)
  throw Error(
    "Usage: prepare-complete-quad-gpu.mjs <cache> [--selected-color-reference <approved-primary-color-package>] [--selected-material-reference <approved-primary-native-observations>]",
  );
for (let i = 0; i < options.length; i += 2) {
  const key = options[i];
  if (
    !["--selected-color-reference", "--selected-material-reference"].includes(
      key,
    ) ||
    references.has(key) ||
    !options[i + 1]
  )
    throw Error("Unique explicit selected native reference flags required");
  references.set(key, options[i + 1]);
}
const selectedReference = references.get("--selected-color-reference"),
  selectedMaterialReference = references.get("--selected-material-reference");
const cache = resolve(arg),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  root = resolve(import.meta.dir, ".."),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {},
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  profile = await read(`${decoder}/profile.json`),
  bound = await read(`${decoder}/vfx-bound-quads.json`),
  effects = await read(`${assets}/latest-effects/manifest.json`),
  shaderPackage = await read(`${assets}/latest-shaders/package.json`),
  pairs = await read(`${cache}/research/latest-shaders/pairs.json`),
  nativeBytes = await raw(`${cache}/research/vfx-materials-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proof = await read(`${cache}/research/vfx-materials-comparison.json`),
  image = await raw(`${decoder}/image.bin`);
if (
  sha(nativeBytes) !== proof.materialPackageSha256 ||
  proof.scope.mismatchCount !== 0 ||
  pairs.shaderPackageSha256 !==
    inputs[`${assets}/latest-shaders/package.json`] ||
  inputs[`${decoder}/vfx-bound-quads.json`] !== profile.vfxBoundQuadsSha256 ||
  sha(image) !== profile.decoderImageSha256 ||
  native.quadPackageSha256 !== profile.vfxBoundQuadsSha256
)
  throw Error("Complete quad material/shader inputs differ");
for (const [name, h] of Object.entries(native.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== h)
    throw Error(`Native quad material source changed: ${name}`);
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Native quad material instructions changed");
const selectedInventory = selectedMaterialReference
  ? await createSelectedNativeMaterialInventory({
      approvedReferenceBytes: await raw(resolve(selectedMaterialReference)),
      materialBytes: nativeBytes,
      boundQuadBytes: await raw(`${decoder}/vfx-bound-quads.json`),
      imageBytes: image,
      profile,
      loadGraph: (file) => raw(`${decoder}/${file}`),
    })
  : null;
const api = await createLatestVfxMaterials(
    nativeBytes,
    sha(nativeBytes),
    profile,
    selectedInventory,
  ),
  emitters = [],
  omitted = [],
  stages = new Map(),
  records = new Map();
const colorBindings = await loadNativeParticleColorBindings({
  assets,
  raw,
  sha,
  selectedReferenceBytes: selectedReference
    ? await raw(resolve(selectedReference))
    : null,
});
await captureDirectSourceInputs(
  [
    resolve(import.meta.dir, "particle-color-bindings.mjs"),
    resolve(root, "latest-vfx-materials.mjs"),
    resolve(root, "latest-native-particle-gpu-binding.mjs"),
  ],
  raw,
);
await raw(`${root}/latest-vfx-materials.mjs`);
await raw(resolve(import.meta.dir, "particle-gpu-bindings.mjs"));
await raw(resolve(import.meta.dir, "particle-color-bindings.mjs"));
for (const ref of bound.templates) {
  if (!records.has(ref.effectId)) {
    const d = effects.definitions[ref.effectId],
      record = await read(`${assets}/latest-effects/${d.file}`);
    if (
      inputs[`${assets}/latest-effects/${d.file}`] !==
      ref.sourceDefinitionSha256
    )
      throw Error("Complete quad definition changed");
    records.set(ref.effectId, record);
  }
  const record = records.get(ref.effectId),
    e = record.definition.complexEmitterDefinitionData[ref.emitterIndex],
    reasons = nativeParticleGpuOmissions(
      e,
      !!e.alphaErosionDefinition,
      colorBindings.has(`${ref.effectId}:${ref.emitterIndex}`),
    );
  if (reasons.length) {
    omitted.push({
      effectId: ref.effectId,
      emitterIndex: ref.emitterIndex,
      reasons,
    });
    continue;
  }
  const environment = {
      pass: 0,
      featuresEnabled: true,
      resourceMask: Number(ref.hasMultDefinition),
      systemFogMode: 1,
      graphics34b: false,
      graphics29c: 0,
    },
    material = api.describe(ref.effectId, ref.emitterIndex, environment, {
      erosionDrive: null,
    });
  if (material.graphSha256 !== ref.sha256)
    throw Error("Quad material/geometry identity differs");
  const n = {
      ...ref,
      environment,
      selection: { vertex: material.vertex, pixel: material.pixel },
      renderState: {
        bytesHex: material.renderStateHex,
        defines: material.defines,
        uniforms: [],
      },
      parameters: [...material.parameters].map(([name, value]) => ({
        name,
        bytesHex: Buffer.from(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        ).toString("hex"),
      })),
      samplers: material.samplers,
      needsErosionDrive: false,
    },
    result = await prepareNativeParticleGpuBinding(n, record, {
      effects,
      shaderPackage,
      pairs,
      assets,
      read,
      raw,
      sha,
      inputs,
      stages,
      colorBindings,
    });
  if (result.omitted) omitted.push(result.omitted);
  else emitters.push(result.binding);
}
for (const r of bound.rejected) {
  const at = r.key.lastIndexOf(":");
  if (at < 0) throw Error("Invalid quad omission identity");
  omitted.push({
    effectId: r.key.slice(0, at),
    emitterIndex: Number(r.key.slice(at + 1)),
    reasons: [`native-runtime:${r.reason}`],
  });
}
const result = {
  schema: 1,
  kind: "prepared-complete-quad-gpu-bindings",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  quadPackageSha256: profile.vfxBoundQuadsSha256,
  effectsManifestSha256: inputs[`${assets}/latest-effects/manifest.json`],
  nativeMaterialSha256: sha(nativeBytes),
  shaderPackageSha256: inputs[`${assets}/latest-shaders/package.json`],
  preparerSha256: sha(await raw(import.meta.path)),
  inputs,
  emitters,
  omitted,
  counts: {
    emitters: emitters.length,
    omitted: omitted.length,
    shaderStages: stages.size,
  },
  scope: {
    completeNativeGraphs: true,
    nativeMaterialValues: true,
    sceneInputsSupplied: true,
    neutralLookupsSupplied: true,
    fullSceneResources: false,
    fullPassScheduling: false,
    postprocess: false,
    browserRun: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${assets}/latest-complete-quad-gpu/package.json`, encoded);
console.log(JSON.stringify({ sha256: sha(encoded), counts: result.counts }));
