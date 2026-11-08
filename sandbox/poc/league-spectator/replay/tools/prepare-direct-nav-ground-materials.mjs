// Extract complete original ground material resource closure. Native source
// controls determine eligibility; complete parent acquisition owns final GPU state.
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  captures = [];
for (let at = 3; at < process.argv.length; at += 2) {
  if (process.argv[at] !== "--native" || !process.argv[at + 1])
    throw Error("Expected --native <complete-parent-report>");
  captures.push(resolve(process.argv[at + 1]));
}
if (!captures.length) throw Error("Complete original parent captures required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Nav ground drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  controls = await read(`${cache}/research/direct-nav-ground-pass-native.json`),
  folder = `${cache}/public/latest-direct-nav-ground-materials`;
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(
  controls.kind,
  "original-navigation-ground-all-pass-material-controls",
);
assert.equal(controls.scope.originalAllSevenPassEligibility, true);
assert.equal(controls.scope.unchangedCompleteEmitterAssets, true);
async function checkEvidence(evidence) {
  assert.equal(evidence.build, profile.clientVersion);
  assert.equal(evidence.protocol, profile.protocolDigest);
  assert.equal(evidence.decoderImageSha256, profile.decoderImageSha256);
  for (const [path, hash] of Object.entries({
    ...evidence.inputs,
    ...evidence.sources,
  }))
    assert.equal(await sha256(await raw(path)), hash, path);
  assert(evidence.originalBlocks.length > 0);
  for (const b of evidence.originalBlocks) {
    assert(
      Number.isInteger(b.rva) &&
        Number.isInteger(b.size) &&
        b.rva >= 0 &&
        b.size > 0 &&
        b.rva + b.size <= image.length,
    );
    assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
  }
}
await checkEvidence(controls);
const nativeById = new Map();
for (const path of captures) {
  const native = await read(path);
  await checkEvidence(native);
  assert.equal(native.scope.unchangedCompleteRootActivation, true);
  assert.equal(native.scope.originalReadOnlyPassLookup, true);
  assert.equal(native.scope.sceneInputsProvided, false);
  assert.equal(native.scope.gpuDrawSubmitted, false);
  assert.equal(native.passes.lookupReadOnly, true);
  assert(!nativeById.has(native.effectId));
  nativeById.set(native.effectId, { native, path });
}
const emitters = [],
  differences = [];
for (const c of controls.cases) {
  assert.deepEqual(
    c.passes.filter((p) => p.eligible).map((p) => p.environment.pass),
    [5],
  );
  const { native, path } = nativeById.get(c.effectId) ?? {};
  assert(native, "Complete original owner capture missing");
  const ref = manifest.definitions[c.effectId],
    record = await read(`${cache}/public/latest-effects/${ref.file}`),
    source = record.definition.complexEmitterDefinitionData[c.emitterIndex];
  assert.equal(
    inputs[resolve(`${cache}/public/latest-effects/${ref.file}`)],
    ref.sha256,
  );
  assert.equal(c.sourceDefinitionSha256, ref.sha256);
  assert.equal(source.primitive.__type, "VfxPrimitiveArbitraryQuad");
  assert([1, true].includes(source.isGroundLayer));
  assert([1, true].includes(source.useNavmeshMask));
  assert.equal(source.alphaErosionDefinition, undefined);
  assert.equal(source.particleColorTexture, undefined);
  const owners = native.ownership.actors.filter(
      (a) => a.emitterIndex === c.emitterIndex,
    ),
    passes = native.passes.actors.filter(
      (a) => a.emitterIndex === c.emitterIndex,
    );
  assert.equal(owners.length, 1);
  assert.equal(passes.length, 1);
  const owner = owners[0],
    actor = passes[0];
  assert.equal(owner.primitiveVtableRva, 0x23f20c8);
  assert.equal(actor.link, owner.link);
  assert.equal(actor.rows.length, 1);
  const row = actor.rows[0];
  assert.equal(row.name, "ground_layer");
  assert.equal(row.hash, 1047222492);
  assert.deepEqual(
    actor.lookups.filter((q) => q.selectedRow !== null).map((q) => q.name),
    ["ground_layer"],
  );
  assert.equal(row.variants.length, 1);
  const v = row.variants[0],
    pipeline = native.pipelines[v.nativePipeline],
    binding = native.bindings[v.nativeBinding],
    program = native.programs[v.nativeProgram];
  assert.equal(pipeline.created, true);
  assert.equal(program.linked, true);
  assert.equal(binding.created, true);
  assert.equal(pipeline.nativeProgram, v.nativeProgram);
  assert.equal(pipeline.glProgram, program.glHandle);
  assert.equal(binding.glProgram, program.glHandle);
  assert.deepEqual(pipeline.state, pipeline.validation.state);
  assert.equal(binding.requiredMaterialTextures.length, 0);
  assert.equal(binding.requiredSceneDataBuffers.length, 0);
  const shaders = {};
  for (const stage of ["vertex", "pixel"]) {
    const matches = Object.values(native.shaders).filter(
      (s) => s.glHandle === program[stage],
    );
    assert.equal(matches.length, 1);
    const s = matches[0];
    assert.equal(s.compiled, true);
    assert.equal(s.path, c.selection[stage]);
    assert.deepEqual(s.defines, c.renderState.defines);
    const bytes = await raw(
      `${cache}/public/latest-shaders/${s.translation.file}`,
    );
    assert.equal(await sha256(bytes), s.translation.sha256);
    const file = `shaders/${s.translation.sha256}.json`;
    await mkdir(dirname(`${folder}/${file}`), { recursive: true });
    await Bun.write(`${folder}/${file}`, bytes);
    shaders[stage] = {
      ...s.translation,
      file,
      path: s.path,
      defines: s.defines,
    };
  }
  const textures = [];
  for (const b of binding.textures) {
    const t = native.textures[b.nativeTexture];
    assert.equal(t.gpuBytesVerified, true);
    assert.equal(t.kind, "2d");
    assert.equal(t.nativeFormat, 2);
    assert.equal(t.layers, 1);
    assert.equal(t.preparedLevels.length, t.mips);
    assert.deepEqual(b.sampler.parameters, b.sampler.queriedParameters);
    const layer =
      b.name === "TEXTURE__TX"
        ? "base"
        : b.name === "PARTICLE_COLOR_TEXTURE__TX"
          ? "color"
          : b.name === "TEXTUREMULT__TX"
            ? "mult"
            : null;
    assert(layer);
    if (layer !== "color") {
      const sampler = c.samplers.find((s) => s.layer === layer);
      assert(sampler);
      const five = Uint8Array.fromHex(sampler.descriptorHex);
      const exact = Uint8Array.fromHex(b.sampler.descriptorHex);
      assert.deepEqual(
        [exact[0], exact[1], exact[2], exact[8], exact[10]],
        Array.from(five),
      );
    }
    for (const [mip, level] of t.preparedLevels.entries()) {
      assert.equal(level.length, 1);
      const plane = level[0],
        bytes = await raw(`${dirname(path)}/${plane.file}`),
        readback = t.readbacks.find((r) => r.mip === mip && r.layer === 0);
      assert.equal(await sha256(bytes), plane.sha256);
      assert.equal(readback.sha256, plane.sha256);
      assert.equal(readback.bytes, bytes.length);
      assert.equal(bytes.length, plane.width * plane.height * 4);
      if (layer === "color")
        assert(
          bytes.every((value) => value === 255),
          "Original default palette must be verified white, not substituted",
        );
      await mkdir(dirname(`${folder}/${plane.file}`), { recursive: true });
      await Bun.write(`${folder}/${plane.file}`, bytes);
    }
    textures.push({
      stage: b.stage,
      name: b.name,
      glslName: b.glslName,
      unit: b.unit,
      dimension: b.dimension,
      layer,
      authoredPath:
        layer === "base"
          ? source.texture.toLowerCase()
          : layer === "mult"
            ? source.textureMult.textureMult.toLowerCase()
            : null,
      width: t.width,
      height: t.height,
      mips: t.mips,
      levels: t.preparedLevels,
      sourcePixelSha256: t.nativeSourceSha256,
      sampler: {
        descriptorHex: b.sampler.descriptorHex,
        parameters: b.sampler.parameters,
      },
    });
  }
  const constants = [];
  for (const b of binding.uniformBuffers) {
    assert.equal(b.gpuBytesVerified, true);
    assert.equal(
      await sha256(Uint8Array.fromHex(b.bytesHex)),
      b.gpuReadbackSha256,
    );
    const shader = JSON.parse(
        new TextDecoder().decode(
          await raw(`${folder}/${shaders[b.stage].file}`),
        ),
      ),
      block = shader.sidecar.blocks.find((x) => x.glslName === b.name);
    assert(block);
    const expected = new Uint8Array(block.size),
      parameters = new Map(
        [...c.parameters, ...c.renderState.uniforms].map((p) => [p.name, p]),
      );
    for (const m of block.members) {
      if (!m.used) continue;
      const p = parameters.get(m.name);
      if (p)
        expected.set(
          Uint8Array.fromHex(p.bytesHex).subarray(0, m.size),
          m.offset,
        );
      else assert(b.nativeZeroInitializedMembers.includes(m.name));
    }
    assert.equal(
      expected.toHex(),
      b.bytesHex,
      "Original parameter values must exactly reproduce full GPU static UBO",
    );
    constants.push({
      stage: b.stage,
      name: b.name,
      binding: b.binding,
      bytesHex: b.bytesHex,
      gpuReadbackSha256: b.gpuReadbackSha256,
    });
  }
  const requiredScene = {
    blocks: binding.requiredSceneBlocks,
    textures: binding.requiredSceneTextures.map(
      ({ nativeResource, reason, ...r }) => r,
    ),
    dataBuffers: binding.requiredSceneDataBuffers,
  };
  assert.deepEqual(
    requiredScene.textures.map((t) => t.name).sort(),
    [
      "FOW_MAP_SharedTexture",
      "NAVMESH_MASK_TEXTURE_SharedTexture",
      "PIXEL_COLOR_REMAP_RAMP_SharedTexture",
    ].sort(),
  );
  const required = requiredScene.blocks
    .flatMap((b) => b.requiredMembers.map((m) => m.name))
    .sort();
  assert.deepEqual(
    required,
    [
      "mProj",
      "vCamera",
      "FOG_OF_WAR_PARAMS",
      "NAV_GRID_XFORM",
      "RENDERTARGET_IS_SRGB",
    ].sort(),
  );
  if (c.renderState.bytesHex !== pipeline.descriptorHex)
    differences.push({
      effectId: c.effectId,
      emitterIndex: c.emitterIndex,
      partialPrefixDescriptorHex: c.renderState.bytesHex,
      completeOriginalDescriptorHex: pipeline.descriptorHex,
      fieldEquivalenceClaim:
        "shader-path-defines-static-parameters-and-authored-samplers-only",
      pipelineAuthority:
        "complete-original-parent-factory-plus-queried-GPU-state",
      manualNormalizationApplied: false,
    });
  emitters.push({
    effectId: c.effectId,
    emitterIndex: c.emitterIndex,
    sourceDefinitionSha256: ref.sha256,
    primitiveVtableRva: owner.primitiveVtableRva,
    passHash: row.hash,
    variantIndex: v.index,
    originalCaptureSha256: inputs[path],
    allPassProofSha256:
      inputs[resolve(`${cache}/research/direct-nav-ground-pass-native.json`)],
    shaders,
    pipeline: { descriptorHex: pipeline.descriptorHex, state: pipeline.state },
    constantBuffers: constants,
    textures,
    requiredScene,
  });
}
await raw(import.meta.path);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const data = {
  schema: 1,
  kind: "prepared-complete-native-navigation-ground-materials",
  build: manifest.build,
  protocol: manifest.protocol,
  decoderImageSha256: profile.decoderImageSha256,
  effectsManifestSha256: await sha256(manifestBytes),
  emitters,
  scope: {
    staticBuildResourcesOnly: true,
    completeNativePass5Resources: true,
    sceneInputsSupplied: false,
    gpuDrawsSubmitted: false,
    nativeWorldAcceptance: null,
  },
};
await mkdir(folder, { recursive: true });
const bytes = new TextEncoder().encode(JSON.stringify(data)),
  hash = await sha256(bytes);
await Bun.write(`${folder}/package.json`, bytes);
const output = `${cache}/research/direct-nav-ground-material-preparation.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "complete-native-navigation-ground-resource-extraction",
      inputs,
      packageSha256: hash,
      components: emitters.length,
      allPassEligibilityCases: controls.cases.length * 7,
      partialHelperPipelineDifferences: differences,
      scope: {
        nativeStaticResourceClosureVerified: true,
        allPassShaderParameterSamplerCrossCheck: true,
        partialHelperPipelineEquivalenceClaim: false,
        completeActivationPipelineIsAuthority: true,
        sceneInputsSupplied: false,
        runtimeAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    packageSha256: hash,
    components: emitters.length,
    pipelinePrefixDifferences: differences.length,
  }),
);
