import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  folder = `${cache}/research/direct-ray-materials-v28`,
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h)
    throw Error("Ray material preparation drift");
  inputs[path] = h;
  return b;
}
const read = async (p) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(p)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${folder}/native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
assert.equal(native.kind, "native-complete-ray-material-observation");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.decoderImageSha256, await sha256(image));
assert.equal(native.scope.unchangedCompleteRootActivation, true);
assert.equal(native.scope.wholeRootGpuMaterialsPrepared, false);
assert.equal(native.scope.unsupportedSiblingGpuReadinessProvided, false);
assert.equal(native.scope.unavailableSiblingGpuFieldsReadGuarded, true);
assert.deepEqual(native.unavailableSiblingBindingFieldReads, []);
for (const copy of native.unavailableSiblingOriginalBaseFlagCopies) {
  assert.equal(copy.rva, 0x17bb943);
  assert.equal(copy.offset, 0x21);
  assert.equal(copy.value, 0);
}
for (const map of [native.inputs, native.sources])
  for (const [p, h] of Object.entries(map))
    assert.equal(await sha256(await raw(p)), h, "Native Ray input differs");
assert.ok(native.originalBlocks.length > 0);
for (const block of native.originalBlocks)
  assert.equal(
    await sha256(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const ref = manifest.definitions[native.effectId],
  definition = await read(`${cache}/public/latest-effects/${ref.file}`);
assert.equal(
  inputs[resolve(`${cache}/public/latest-effects/${ref.file}`)],
  ref.sha256,
);
const expectedPair = {
  vertex: "924cda2a7adbe0a9b2e7c7fcd6fc459f08694dd55bb17fa73441d98dd2691afe",
  pixel: "6c8919d2888115e1acf410b50631b4bf8b471a9412884e2c2507843c95a164b6",
};
const emitters = [];
for (const actor of native.ownership.actors.filter(
  (a) => a.primitiveVtableRva === 0x23f26e0,
)) {
  const source =
      definition.definition.complexEmitterDefinitionData[actor.emitterIndex],
    material = native.passes.actors.find(
      (a) => a.emitterIndex === actor.emitterIndex,
    );
  assert.equal(source.primitive.__type, "VfxPrimitiveRay");
  assert.equal(material.link, actor.link);
  const rows = [];
  for (const row of material.rows) {
    const variants = [];
    for (const v of row.variants) {
      const binding = native.bindings[v.nativeBinding],
        pipeline = native.pipelines[v.nativePipeline],
        program = native.programs[v.nativeProgram];
      assert.equal(binding.created, true);
      assert.equal(pipeline.created, true);
      assert.equal(program.linked, true);
      assert.equal(pipeline.nativeProgram, v.nativeProgram);
      assert.equal(pipeline.glProgram, program.glHandle);
      assert.equal(binding.glProgram, program.glHandle);
      assert.deepEqual(pipeline.state, pipeline.validation.state);
      assert.equal(binding.requiredMaterialTextures.length, 0);
      assert.equal(binding.requiredSceneDataBuffers.length, 0);
      const shaders = {};
      for (const side of ["vertex", "pixel"]) {
        const s = Object.values(native.shaders).filter(
          (s) => s.glHandle === program[side],
        );
        assert.equal(s.length, 1);
        assert.equal(s[0].compiled, true);
        const r = s[0].translation,
          b = await raw(`${cache}/public/latest-shaders/${r.file}`);
        assert.equal(await sha256(b), r.sha256);
        assert.equal(r.sha256, expectedPair[side]);
        const file = `shaders/${r.sha256}.json`;
        await Bun.write(`${folder}/${file}`, b);
        shaders[side] = {
          ...r,
          file,
          path: s[0].path,
          defines: s[0].defines,
          permutationDefines: s[0].permutationDefines,
        };
      }
      const constantBuffers = binding.uniformBuffers;
      for (const b of constantBuffers) {
        assert.equal(b.gpuBytesVerified, true);
        assert.equal(
          await sha256(Uint8Array.fromHex(b.bytesHex)),
          b.gpuReadbackSha256,
        );
      }
      assert.equal(
        constantBuffers.find((b) => b.stage === "vertex").bytesHex,
        "000080400000803e0000803f0000000000000000000000000000000000000000",
      );
      assert.equal(
        constantBuffers.find((b) => b.stage === "pixel").bytesHex,
        "a1a0a03c000000000000000000000000",
      );
      const textures = [];
      for (const t of binding.textures) {
        const resource = native.textures[t.nativeTexture],
          registrations = native.preloadedTextures.filter(
            (r) => r.pointer === t.nativeTexture,
          );
        assert.equal(registrations.length, 1);
        const path = registrations[0].path.toLowerCase(),
          asset = manifest.assets[path];
        assert.equal(asset.kind, "texture");
        assert.equal(asset.status, "prepared");
        assert.equal(resource.gpuBytesVerified, true);
        assert.equal(resource.kind, "2d");
        assert.equal(resource.layers, 1);
        assert.equal(resource.mips, 1);
        assert.equal(resource.nativeFormat, 2);
        assert.deepEqual(t.sampler.parameters, t.sampler.queriedParameters);
        const palette = t.name === "PARTICLE_COLOR_TEXTURE__TX";
        assert.equal(
          t.name,
          palette ? "PARTICLE_COLOR_TEXTURE__TX" : "TEXTURE__TX",
        );
        assert.equal(
          path,
          (palette
            ? source.particleColorTexture
            : source.texture
          ).toLowerCase(),
        );
        assert.equal(
          t.sampler.descriptorHex,
          palette
            ? "01010100000000000100010100000000"
            : "00000000000000000100010100000000",
        );
        for (const level of resource.preparedLevels)
          for (const plane of level) {
            const b = await raw(`${folder}/${plane.file}`);
            assert.equal(await sha256(b), plane.sha256);
            assert.equal(b.length, plane.bytes);
            assert.equal(plane.bytes, plane.width * plane.height * 4);
            const readback = resource.readbacks.find(
              (r) => r.layer === plane.layer && r.mip === plane.mip,
            );
            assert.equal(readback.sha256, plane.sha256);
          }
        textures.push({
          name: t.name,
          stage: t.stage,
          glslName: t.glslName,
          unit: t.unit,
          sampler: t.sampler,
          path,
          sourceSha256: asset.sourceSha256,
          width: resource.width,
          height: resource.height,
          pixelFormat: "RGBA8",
          kind: "2d",
          levels: resource.preparedLevels,
        });
      }
      assert.equal(textures.length, 2);
      variants.push({
        index: v.index,
        shaders,
        constantBuffers,
        textures,
        pipeline: {
          descriptorHex: pipeline.descriptorHex,
          state: pipeline.state,
        },
        requiredScene: {
          blocks: binding.requiredSceneBlocks,
          textures: binding.requiredSceneTextures,
          dataBuffers: binding.requiredSceneDataBuffers,
        },
      });
    }
    rows.push({ name: row.name, hash: row.hash, index: row.index, variants });
  }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "post_distortion");
  assert.equal(rows[0].hash, 2700020711);
  assert.equal(rows[0].variants.length, 1);
  emitters.push({
    effectId: native.effectId,
    emitterIndex: actor.emitterIndex,
    sourceDefinitionSha256: ref.sha256,
    primitiveVtableRva: 0x23f26e0,
    writerRva: 0x1734a30,
    vertexStride: 28,
    rows,
    aliases: material.aliases,
  });
}
assert.ok(emitters.length > 0);
const omittedBindings = Object.values(native.bindings).filter(
  (b) => !b.created,
);
for (const b of omittedBindings) {
  assert.equal(b.drawReady, false);
  assert.equal(b.requestRecordedOnly, true);
  assert.deepEqual(b.omissions, [
    "material:unrelated-sibling-native-border-sampler-untranslated",
  ]);
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final Ray preparation drift",
  );
const result = {
  schema: 1,
  kind: "prepared-direct-ray-materials",
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  effectsManifestSha256: await sha256(manifestBytes),
  inputs,
  emitters,
  scope: {
    selectedRayStaticResourcesGpuVerified: true,
    wholeRootGpuPrepared: false,
    unrelatedSiblingOmissions: omittedBindings.length,
    sceneInputsResolved: false,
    gpuDrawSubmitted: false,
    runtimeAdmissionChanged: false,
  },
};
const output = `${folder}/package.json`,
  bytes = new TextEncoder().encode(JSON.stringify(result, null, 2));
await Bun.write(output, bytes);
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(bytes),
    emitters: emitters.length,
    inputs: Object.keys(inputs).length,
    omittedBindings: omittedBindings.length,
  }),
);
