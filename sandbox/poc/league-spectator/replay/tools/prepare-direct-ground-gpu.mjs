// Use the existing verified material API and static GPU preparer for native
// ground pass5. Missing scene inputs remain explicit; no pass0 binding is used.
import { resolve } from "node:path";
import { createLatestVfxMaterials } from "../latest-vfx-materials.mjs";
import { prepareNativeParticleGpuBinding } from "./particle-gpu-bindings.mjs";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
import { completeNativeGroundBinding } from "./direct-ground-bindings.mjs";
import { PARENT_QUAD_GPU_SHA } from "../latest-parent-render-frame.mjs";
import {
  DIRECT_GROUND_POLICY,
  DIRECT_GROUND_OMISSIONS,
} from "../latest-direct-ground-contract.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const inputs = {},
  stages = new Map();
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const digest = sha(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Ground input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const profile = await read(`${decoder}/profile.json`);
const bound = await read(`${decoder}/vfx-bound-quads.json`);
const effects = await read(`${assets}/latest-effects/manifest.json`);
const shaderPackage = await read(`${assets}/latest-shaders/package.json`);
const pairs = await read(`${cache}/research/latest-shaders/pairs.json`);
const nativeBytes = await raw(`${cache}/research/vfx-materials-native.json`);
const native = JSON.parse(new TextDecoder().decode(nativeBytes));
const comparison = await read(
  `${cache}/research/vfx-materials-comparison.json`,
);
const proofPaths = [`${cache}/research/direct-ground-layer-native.json`];
for (let i = 3; i < process.argv.length; i += 2) {
  if (process.argv[i] !== "--additional-proof" || !process.argv[i + 1])
    throw Error("Expected --additional-proof <native-report-path>");
  const path = resolve(process.argv[i + 1]);
  if (proofPaths.map((p) => resolve(p)).includes(path))
    throw Error("Duplicate native ground pass proof");
  proofPaths.push(path);
}
const proofs = await Promise.all(proofPaths.map(read));
const previous = await read(`${assets}/latest-complete-quad-gpu/package.json`);
if (
  inputs[`${assets}/latest-complete-quad-gpu/package.json`] !==
  PARENT_QUAD_GPU_SHA
)
  throw Error(
    "Ground static texture resource package differs from the pinned quad package",
  );
const fowPath = `${cache}/research/direct-ground-fow-native.json`;
const fow = await read(fowPath);
const texture = fow.defaultTextures.offsetA0.resource;
if (
  !texture.gpuBytesVerified ||
  texture.width !== 1 ||
  texture.height !== 1 ||
  texture.nativeFormat !== 2 ||
  JSON.stringify(texture.levelsHex) !== '[["ffffffff"]]'
)
  throw Error("Exact original constructor all-vision texture required");
const extentControl = fow.uniformControls.find((c) => c.suppliedExtent === 100);
if (!extentControl) throw Error("Explicit native FoW extent control required");
const nativeGroundAllVision = {
  policy: DIRECT_GROUND_POLICY,
  rgbaHex: texture.levelsHex[0][0],
  nativeProofSha256: inputs[fowPath],
  nativeTextureSha256: texture.nativeSourceSha256,
  suppliedExtentControl: extentControl.suppliedExtent,
  uniformBytesHex: Buffer.from(
    new Float32Array(extentControl.nativeVector).buffer,
  ).toString("hex"),
  omissions: [...DIRECT_GROUND_OMISSIONS],
};
if (
  sha(nativeBytes) !== comparison.materialPackageSha256 ||
  comparison.scope.mismatchCount !== 0 ||
  pairs.shaderPackageSha256 !==
    inputs[`${assets}/latest-shaders/package.json`] ||
  inputs[`${decoder}/vfx-bound-quads.json`] !== profile.vfxBoundQuadsSha256 ||
  native.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
  sha(await raw(`${decoder}/image.bin`)) !== profile.decoderImageSha256
)
  throw Error("Ground native material/shader package differs");
for (const [file, digest] of Object.entries(native.sources))
  if (sha(await raw(resolve(import.meta.dir, file))) !== digest)
    throw Error(`Ground native material producer changed: ${file}`);
const controls = [],
  identities = new Set();
const image = await raw(`${decoder}/image.bin`);
for (const proof of proofs) {
  if (
    proof.schema !== 1 ||
    proof.kind !== "original-ground-layer-pass-material-controls" ||
    proof.build !== effects.build ||
    proof.protocol !== effects.protocol ||
    !proof.scope?.originalFullPassEligibility ||
    !proof.scope?.originalShaderSelection ||
    !proof.scope?.unchangedPreparedEmitters ||
    !Array.isArray(proof.cases) ||
    !proof.cases.length ||
    !Object.keys(proof.sources ?? {}).length ||
    !Object.keys(proof.inputs ?? {}).length ||
    !(proof.sourceSites?.length || proof.originalBlocks?.length)
  )
    throw Error("Exact nonempty original ground pass proof required");
  for (const [file, digest] of Object.entries(proof.sources))
    if (sha(await raw(resolve(import.meta.dir, file))) !== digest)
      throw Error(`Ground pass control producer changed: ${file}`);
  for (const [path, digest] of Object.entries(proof.inputs))
    if (sha(await raw(path)) !== digest)
      throw Error(`Ground pass control input changed: ${path}`);
  for (const site of proof.sourceSites ?? [])
    if (sha(image.subarray(site.startRva, site.endRva)) !== site.sha256)
      throw Error("Ground native pass instruction bytes changed");
  for (const block of proof.originalBlocks ?? [])
    if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
      throw Error("Additional ground native instruction bytes changed");
  for (const control of proof.cases) {
    const key = `${control.effectId}:${control.emitterIndex}`;
    if (identities.has(key))
      throw Error("Duplicate native ground component proof");
    identities.add(key);
    controls.push(control);
  }
}
const api = await createLatestVfxMaterials(
  nativeBytes,
  sha(nativeBytes),
  profile,
);
const colorBindings = await loadNativeParticleColorBindings({
  assets,
  raw,
  sha,
});
const prepared = [],
  omitted = [],
  attempts = [];
for (const control of controls) {
  const ref = bound.templates.find(
    (e) =>
      e.effectId === control.effectId &&
      e.emitterIndex === control.emitterIndex,
  );
  if (!ref || ref.sourceDefinitionSha256 !== control.sourceDefinitionSha256)
    throw Error("Ground component/static graph identity differs");
  const sourceRef = effects.definitions[ref.effectId];
  const record = await read(`${assets}/latest-effects/${sourceRef.file}`);
  if (
    inputs[`${assets}/latest-effects/${sourceRef.file}`] !==
    ref.sourceDefinitionSha256
  )
    throw Error("Ground source definition changed");
  const environment = control.passes[5].environment;
  if (
    !control.passes[5].eligible ||
    environment.pass !== 5 ||
    environment.systemFogMode !== control.originalPreparedRootFogMode
  )
    throw Error("Ground package requires the proven actual-root pass5 input");
  const material = api.describe(ref.effectId, ref.emitterIndex, environment, {
    erosionDrive: null,
  });
  if (
    material.graphSha256 !== ref.sha256 ||
    material.vertex !== control.passes[5].shader.vertex ||
    material.pixel !== control.passes[5].shader.pixel
  )
    throw Error(
      "Ground translated material differs from the original selection",
    );
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
  };
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
  // Retain exact installed shader references even when the shared preparer
  // correctly refuses a render binding for absent scene resources.
  const family = shaderPackage.pairs.find(
    (p) =>
      p.vertex === n.selection.vertex.toLowerCase() &&
      p.pixel === n.selection.pixel.toLowerCase(),
  );
  if (!family) throw Error("Ground shader family is not statically prepared");
  const declared = new Map(
    pairs.groups
      .find((g) => g.name === family.name)
      .declares.map((d) => [d.name, d.value]),
  );
  const defines = n.renderState.defines
    .filter((d) => declared.get(d.name) === d.value)
    .sort((a, b) => a.name.localeCompare(b.name));
  const matches = pairs.programs.filter(
    (p) =>
      p.family === family.name &&
      JSON.stringify(p.defines) === JSON.stringify(defines),
  );
  if (matches.length !== 1)
    throw Error("Ground shader permutation is not exact and unique");
  const shaderProgram = matches[0];
  const shaders = [];
  for (const stage of ["vertex", "pixel"]) {
    const reference = shaderProgram[stage];
    const path = `${assets}/latest-shaders/${reference.file}`;
    const shader = await read(path);
    shaders.push(shader);
    if (inputs[path] !== reference.sha256)
      throw Error("Ground static shader bytes differ");
    stages.set(reference.sha256, {
      ...reference,
      requiredUniformBlocks: shader.sidecar.blocks,
      requiredTextures: shader.sidecar.textures,
    });
  }
  attempts.push({
    effectId: ref.effectId,
    emitterIndex: ref.emitterIndex,
    sourceDefinitionSha256: ref.sourceDefinitionSha256,
    graphSha256: ref.sha256,
    environment,
    selection: n.selection,
    shaderProgram,
    nativeRenderState: n.renderState,
    nativeParameters: n.parameters,
    samplers: material.samplers,
  });
  const old = previous.emitters.find(
    (e) => e.effectId === ref.effectId && e.emitterIndex === ref.emitterIndex,
  );
  if (!old) throw Error("Ground static texture resource observation missing");
  prepared.push(
    completeNativeGroundBinding({
      n,
      result,
      shaders,
      pair: shaderProgram,
      defines,
      family: family.name,
      previous: old,
      policy: nativeGroundAllVision,
      emitter: record.definition.complexEmitterDefinitionData[ref.emitterIndex],
    }),
  );
}
for (const file of [
  import.meta.path,
  resolve(import.meta.dir, "particle-gpu-bindings.mjs"),
  resolve(import.meta.dir, "particle-color-bindings.mjs"),
  resolve(import.meta.dir, "direct-ground-bindings.mjs"),
  resolve(import.meta.dir, "..", "latest-direct-ground-contract.mjs"),
  resolve(import.meta.dir, "..", "latest-parent-render-frame.mjs"),
  resolve(import.meta.dir, "..", "latest-vfx-materials.mjs"),
])
  await raw(file);
const result = {
  schema: 1,
  kind: "prepared-direct-native-ground-pass-materials",
  effectsManifestSha256: inputs[`${assets}/latest-effects/manifest.json`],
  scenePolicy: nativeGroundAllVision,
  build: effects.build,
  protocol: effects.protocol,
  inputs,
  attempts,
  shaderStages: [...stages.values()],
  emitters: prepared,
  omitted,
  counts: {
    candidates: attempts.length,
    bound: prepared.length,
    omitted: omitted.length,
    shaderStages: stages.size,
  },
  scope: {
    exactOriginalGroundPass5: true,
    actualPreparedRootFogMode: true,
    sharedVerifiedMaterialTranslatorAndGpuPreparer: true,
    sceneResourcesSynthesized: false,
    compilerAdmissionChanged: false,
    allVisionDiagnosticPolicy: true,
    actualSpectatorFlagRecovered: false,
    actualMapExtentRecovered: false,
    gpuDrawsSubmitted: false,
    actualMatchCoverage: false,
  },
};
const output = `${assets}/latest-direct-ground-materials/package.json`;
for (const [path, expected] of Object.entries(inputs))
  if (sha(await Bun.file(path).bytes()) !== expected)
    throw Error(`Ground input changed before publication: ${path}`);
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ output, counts: result.counts, omitted }, null, 2),
);
