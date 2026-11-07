// Bind native CameraTrail material observations to prepared game shaders.
import { resolve } from "node:path";
import { prepareNativeParticleGpuBinding } from "./particle-gpu-bindings.mjs";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: prepare-trail-gpu.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {},
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  trails = await read(`${assets}/latest-trail-particles/package.json`),
  native = await read(`${cache}/research/trail-materials-native.json`),
  effects = await read(`${assets}/latest-effects/manifest.json`),
  shaderPackage = await read(`${assets}/latest-shaders/package.json`),
  pairs = await read(`${cache}/research/latest-shaders/pairs.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
if (
  native.trailPackageSha256 !==
    inputs[`${assets}/latest-trail-particles/package.json`] ||
  pairs.shaderPackageSha256 !==
    inputs[`${assets}/latest-shaders/package.json`] ||
  sha(image) !== trails.decoderImageSha256
)
  throw Error("Trail shader inputs changed");
for (const [name, h] of Object.entries(native.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== h)
    throw Error(`Trail material source changed: ${name}`);
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Trail material instructions changed");
await raw(resolve(import.meta.dir, "particle-gpu-bindings.mjs"));
await raw(resolve(import.meta.dir, "particle-color-bindings.mjs"));
const colorBindings = await loadNativeParticleColorBindings({
  assets,
  raw,
  sha,
});
const emitters = [],
  omitted = [],
  stages = new Map();
for (const n of native.entries) {
  const ref = effects.definitions[n.effectId],
    record = await read(`${assets}/latest-effects/${ref.file}`);
  if (
    inputs[`${assets}/latest-effects/${ref.file}`] !== n.sourceDefinitionSha256
  )
    throw Error("Trail effect definition changed");
  const result = await prepareNativeParticleGpuBinding(n, record, {
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
const result = {
  schema: 1,
  kind: "prepared-native-trail-gpu-bindings",
  build: trails.build,
  protocol: trails.protocol,
  trailPackageSha256: inputs[`${assets}/latest-trail-particles/package.json`],
  nativeMaterialSha256: inputs[`${cache}/research/trail-materials-native.json`],
  effectsManifestSha256: inputs[`${assets}/latest-effects/manifest.json`],
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
await Bun.write(`${assets}/latest-trail-particles/gpu.json`, encoded);
console.log(JSON.stringify({ sha256: sha(encoded), counts: result.counts }));
