// Independent original birth/update/matrix/writer observations. No compiler
// admission, match activation, browser playback or GPU draw is implied.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  createLatestDirectMultUvMaterials,
  isLatestDirectMultUvMaterials,
} from "../latest-direct-mult-uv-materials.mjs";
import {
  compileDirectConstantMultUv,
  validateDirectConstantMultUv,
  directConstantMultUvMatrix,
  directConstantMultUvCorners,
} from "../latest-direct-effect-mult-uv.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Multiply-UV input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-mult-uv-native.json`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  materials = await read(
    `${cache}/public/latest-complete-quad-gpu/package.json`,
  );
const materialPrograms = await createLatestDirectMultUvMaterials({
  effectsManifestBytes: manifestBytes,
  quadPackageBytes: await raw(
    `${cache}/public/latest-complete-quad-gpu/package.json`,
  ),
});
assert.equal(isLatestDirectMultUvMaterials(materialPrograms), true);
assert.equal(isLatestDirectMultUvMaterials({ ...materialPrograms }), false);
assert.equal(native.kind, "original-complete-multiply-uv-controls");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
assert.equal(native.effectsManifestSha256, await sha256(manifestBytes));
assert.equal(native.scope.completeUnchangedTypedSources, true);
assert.equal(
  native.scope.originalUvClassificationBirthUpdateAndVertexWriters,
  true,
);
assert.equal(native.selected.length, 8);
assert.equal(native.cases.length, 64);
assert.equal(native.matrixControls.length, 72);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash, path);
const counts = {
  constantComponents: 0,
  completeEmitterFrames: 0,
  matrixLanes: 0,
  packedMultHalfLanes: 0,
  texturePresenceStatePairs: 0,
  matrixControls: 0,
  matrixControlFrames: 0,
  leafMatrixLanes: 0,
  preparedMaterialBindings: 0,
};
const selected = [],
  deferred = [];
for (const record of native.selected) {
  const ref = manifest.definitions[record.effectId],
    bytes = await raw(`${cache}/public/latest-effects/${ref.file}`);
  assert.equal(await sha256(bytes), record.sourceDefinitionSha256);
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(bytes)).definition
      .complexEmitterDefinitionData[record.emitterIndex],
    record.source,
  );
  const primitive =
      record.primitiveKind === "camera" ? "camera-quad" : "arbitrary-quad",
    program = compileDirectConstantMultUv(record.source, primitive),
    cases = native.cases.filter(
      (c) =>
        c.effectId === record.effectId &&
        c.emitterIndex === record.emitterIndex,
    );
  assert.equal(cases.length, 8);
  for (const present of cases.filter((c) => c.multTexturePresent)) {
    const absent = cases.find(
      (c) =>
        !c.multTexturePresent &&
        c.seedHex === present.seedHex &&
        c.pose === present.pose,
    );
    assert.equal(absent.frames.length, present.frames.length);
    for (let i = 0; i < present.frames.length; i++) {
      assert.deepEqual(
        present.frames[i].output.state,
        absent.frames[i].output.state,
      );
      counts.texturePresenceStatePairs++;
    }
  }
  if (!program) {
    deferred.push({
      effectId: record.effectId,
      emitterIndex: record.emitterIndex,
      reason: "dynamic-multiply-UV-scale-not-constant-subset",
    });
    continue;
  }
  validateDirectConstantMultUv({
    source: record.source,
    primitive,
    multUvProgram: program,
  });
  const matrix = directConstantMultUvMatrix(program),
    corners = directConstantMultUvCorners(program);
  for (const c of cases)
    for (const fr of c.frames) {
      counts.completeEmitterFrames++;
      const hex = fr.output.state.vectors.unknown88.hex,
        nativeMatrix = new Float32Array(Uint8Array.fromHex(hex).buffer);
      assert.equal(nativeMatrix.length % 6, 0);
      for (let i = 0; i < nativeMatrix.length; i++) {
        assert.equal(
          Object.is(nativeMatrix[i], matrix[i % 6]),
          true,
          `Native matrix lane ${record.effectId}:${record.emitterIndex}:${i}`,
        );
        counts.matrixLanes++;
      }
      if (!c.multTexturePresent) continue;
      const b = new DataView(
        Uint8Array.fromHex(fr.output.geometry.verticesHex).buffer,
      );
      assert.equal(b.byteLength % 112, 0);
      for (let i = 0; i < b.byteLength / 28; i++)
        for (let lane = 0; lane < 2; lane++) {
          assert.equal(
            corners[(i % 4) * 2 + lane],
            b.getUint16(i * 28 + 24 + lane * 2, true),
            `Native half lane ${record.effectId}:${record.emitterIndex}:${i}:${lane}`,
          );
          counts.packedMultHalfLanes++;
        }
    }
  const material = materials.emitters.find(
    (e) =>
      e.effectId === record.effectId && e.emitterIndex === record.emitterIndex,
  );
  assert.ok(material, "Original prepared multiply material required");
  assert.equal(material.sourceDefinitionSha256, ref.sha256);
  assert.ok(
    material.nativeDefines.some(
      (d) => d.name === "MULT_PASS" && d.value === "1",
    ),
  );
  const materialEmitter = {
    materialKey: `${record.effectId}:${record.emitterIndex}`,
    source: record.source,
    primitive,
    multUvProgram: program,
    groundLayer: false,
  };
  assert.deepEqual(materialPrograms.admit(materialEmitter, material), {
    supported: true,
    reasons: [],
  });
  const forged = structuredClone(material);
  forged.textures.TEXTUREMULT_TX.sha256 = "0".repeat(64);
  assert.throws(() => materialPrograms.admit(materialEmitter, forged));
  const asset = manifest.assets[program.texture.toLowerCase()],
    binding = material.textures.TEXTUREMULT_TX;
  assert.equal(binding.kind, "prepared-texture");
  assert.equal(binding.file, asset.file);
  assert.equal(binding.sha256, asset.sha256);
  assert.equal(
    binding.sampler.name,
    ["repeat", "mirror", "clamp"][program.addressMode],
  );
  assert.equal(
    await sha256(await raw(`${cache}/public/latest-effects/${asset.file}`)),
    asset.sha256,
  );
  for (const stage of ["vertex", "pixel"]) {
    const ref = material.shaders[stage];
    assert.equal(
      await sha256(await raw(`${cache}/public/latest-shaders/${ref.file}`)),
      ref.sha256,
    );
  }
  counts.preparedMaterialBindings++;
  counts.constantComponents++;
  selected.push({
    effectId: record.effectId,
    emitterIndex: record.emitterIndex,
    primitive,
    program,
    shaderPair: Object.fromEntries(
      Object.entries(material.shaders).map(([k, v]) => [k, v.sha256]),
    ),
    sampler: binding.nativeSamplerHex,
  });
}
for (const c of native.matrixControls) {
  const program = compileDirectConstantMultUv(c.source, "arbitrary-quad");
  assert.ok(program);
  const matrix = directConstantMultUvMatrix(program);
  counts.matrixControls++;
  for (const fr of c.frames) {
    counts.matrixControlFrames++;
    if (fr.output.matrices.mult === null) {
      assert.equal(program.linked, false);
      continue;
    }
    const expected = new Float32Array(
      Uint8Array.fromHex(fr.output.matrices.mult).buffer,
    );
    assert.equal(expected.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.equal(
        Object.is(matrix[i], expected[i]),
        true,
        `Independent native leaf lane ${i}`,
      );
      counts.leafMatrixLanes++;
    }
  }
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final input drift: ${path}`,
  );
const result = {
    schema: 1,
    kind: "native-direct-constant-multiply-uv-comparison",
    inputs,
    counts,
    selected,
    deferred,
    mismatches: [],
    scope: {
      completeUnchangedTypedSources: true,
      constantMatrixLanesBitExact: true,
      packedHalfLanesBitExact: true,
      suppliedTexturePresenceDoesNotAlterParticleState: true,
      preparedOriginalMaterialAndSamplerInputsOnly: true,
      coreRuntimeIntegrated: false,
      gpuDrawsSubmitted: false,
      nativeMatchAcceptance: null,
      browserAcceptance: false,
    },
  },
  output = `${cache}/research/direct-mult-uv-comparison.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts,
    deferred: deferred.length,
    inputs: Object.keys(inputs).length,
    mismatches: 0,
  }),
);
