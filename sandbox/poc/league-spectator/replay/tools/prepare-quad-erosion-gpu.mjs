// Additional quad materials using the original vertex erosion lane. This does
// not replace the existing pinned material package or invent live drive values.
import { resolve } from "node:path";
import { createLatestVfxMaterials } from "../latest-vfx-materials.mjs";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
import { prepareNativeParticleGpuBinding } from "./particle-gpu-bindings.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  decoder = `${assets}/decoder-16.21-macos`,
  profile = await read(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  bound = await read(`${decoder}/vfx-bound-quads.json`),
  nativeBytes = await raw(`${cache}/research/vfx-materials-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proof = await read(`${cache}/research/vfx-materials-comparison.json`),
  drive = await read(`${cache}/research/quad-erosion-input-native.json`),
  effects = await read(`${assets}/latest-effects/manifest.json`),
  shaderPackage = await read(`${assets}/latest-shaders/package.json`),
  pairs = await read(`${cache}/research/latest-shaders/pairs.json`);
if (
  sha(image) !== profile.decoderImageSha256 ||
  sha(nativeBytes) !== proof.materialPackageSha256 ||
  proof.scope.mismatchCount !== 0 ||
  native.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
  inputs[`${decoder}/vfx-bound-quads.json`] !== profile.vfxBoundQuadsSha256 ||
  pairs.shaderPackageSha256 !==
    inputs[`${assets}/latest-shaders/package.json`] ||
  drive.kind !== "native-batched-quad-erosion-input" ||
  drive.build !== profile.clientVersion ||
  drive.protocol !== profile.protocolDigest ||
  drive.decoderImageSha256 !== sha(image) ||
  drive.uniform.name !== "USE_INSTANCE_DRAW" ||
  drive.uniform.value !== 1 ||
  drive.vertexInput.byteOffset !== 22 ||
  drive.vertexInput.encoding !== "float16" ||
  !drive.scope.nativeHalfPackingObserved ||
  !drive.scope.nativeCallsiteObserved
)
  throw Error("Quad erosion native inputs differ");
for (const evidence of [native, drive]) {
  for (const [name, digest] of Object.entries(evidence.sources))
    if (sha(await raw(`${root}/tools/${name}`)) !== digest)
      throw Error(`Quad erosion native producer changed: ${name}`);
  for (const b of evidence.originalBlocks)
    if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
      throw Error("Quad erosion native code changed");
}
const api = await createLatestVfxMaterials(
    nativeBytes,
    sha(nativeBytes),
    profile,
  ),
  nativeByKey = new Map(
    native.emitters.map((e) => [`${e.effectId}:${e.emitterIndex}`, e]),
  ),
  colorBindings = await loadNativeParticleColorBindings({ assets, raw, sha }),
  context = {
    effects,
    shaderPackage,
    pairs,
    assets,
    read,
    raw,
    sha,
    inputs,
    stages: new Map(),
    colorBindings,
    vertexErosion: true,
  },
  emitters = [],
  omitted = [],
  records = new Map();
for (const ref of bound.templates) {
  if (!records.has(ref.effectId)) {
    const record = await read(
      `${assets}/latest-effects/${effects.definitions[ref.effectId].file}`,
    );
    if (
      inputs[
        `${assets}/latest-effects/${effects.definitions[ref.effectId].file}`
      ] !== ref.sourceDefinitionSha256
    )
      throw Error("Quad erosion source definition changed");
    records.set(ref.effectId, record);
  }
  const record = records.get(ref.effectId),
    emitter = record.definition.complexEmitterDefinitionData[ref.emitterIndex];
  if (!emitter.alphaErosionDefinition) continue;
  const environment = {
      pass: 0,
      featuresEnabled: true,
      resourceMask: nativeByKey.get(`${ref.effectId}:${ref.emitterIndex}`)
        .definedObjectMask,
      systemFogMode: 1,
      graphics34b: false,
      graphics29c: 0,
    },
    material = api.describe(ref.effectId, ref.emitterIndex, environment, {
      erosionDrive: 0,
    });
  if (material.graphSha256 !== ref.sha256)
    throw Error("Quad erosion graph differs");
  const result = await prepareNativeParticleGpuBinding(
    {
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
      needsErosionDrive: true,
    },
    record,
    context,
  );
  if (result.omitted) omitted.push(result.omitted);
  else emitters.push(result.binding);
}
const sources = {};
for (const name of [
  "latest-vfx-materials.mjs",
  "tools/particle-gpu-bindings.mjs",
  "tools/particle-color-bindings.mjs",
  "tools/prepare-quad-erosion-gpu.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "prepared-quad-vertex-erosion-gpu-bindings",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  effectsManifestSha256: inputs[`${assets}/latest-effects/manifest.json`],
  quadPackageSha256: profile.vfxBoundQuadsSha256,
  nativeMaterialSha256: sha(nativeBytes),
  nativeInputSha256: inputs[`${cache}/research/quad-erosion-input-native.json`],
  shaderPackageSha256: inputs[`${assets}/latest-shaders/package.json`],
  inputs,
  sources,
  emitters,
  omitted,
  counts: {
    emitters: emitters.length,
    omitted: omitted.length,
    shaderStages: context.stages.size,
  },
  scope: {
    nativeVertexDrive: true,
    dynamicDrivePlaceholderUnused: true,
    nativeMaterialValues: true,
    suppliedSceneInputs: true,
    fullSceneResources: false,
    browserRun: false,
    referenceCompared: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${assets}/latest-quad-erosion-gpu/package.json`, encoded);
console.log(JSON.stringify({ sha256: sha(encoded), counts: result.counts }));
