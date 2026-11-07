import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  createLatestDirectStaticMeshMaterials,
  isLatestDirectStaticMeshMaterials,
} from "../latest-direct-static-mesh-materials.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  folder = `${cache}/research/direct-static-mesh-materials`,
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Static mesh preparation input drift");
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${folder}/native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  systems = await read(`${cache}/public/latest-vfx-system-assets/package.json`);
const individualNative = await read(
    `${cache}/research/direct-mesh-draw-branch-native.json`,
  ),
  individualProof = await read(
    `${cache}/research/direct-mesh-draw-branch-comparison.json`,
  );
assert.equal(
  individualProof.kind,
  "original-individual-mesh-shader-branch-comparison",
);
assert.equal(individualProof.originalInstanceFlag, 0);
assert.equal(individualProof.scope.nativeIndividualMeshPrefixExecuted, true);
assert.equal(individualProof.scope.instance208PayloadProduced, false);
for (const evidence of [individualNative, individualProof])
  for (const map of [evidence.inputs, evidence.sources ?? {}])
    for (const [path, hash] of Object.entries(map))
      assert.equal(
        await sha256(await raw(path)),
        hash,
        "Individual mesh evidence drift",
      );
assert.equal(individualNative.build, native.build);
assert.equal(individualNative.effectId, native.effectId);
assert.equal(individualNative.scope.gpuMaterialUniformUpdatesApplied, false);
if (
  native.kind !== "native-static-mesh-material-observation" ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  (await sha256(image)) !== profile.decoderImageSha256 ||
  native.graphSha256 !== systems.systems[native.effectId]?.sha256 ||
  native.scope.unchangedCompleteRootActivation !== true ||
  native.scope.originalReadOnlyPassLookup !== true ||
  native.scope.sceneInputsProvided !== false ||
  native.scope.gpuDrawSubmitted !== false ||
  !native.originalBlocks.length ||
  !Object.keys(native.sources).length ||
  !Object.keys(native.inputs).length
)
  throw Error("Complete exact original mesh material activation required");
for (const map of [native.inputs, native.sources])
  for (const [p, h] of Object.entries(map))
    if ((await sha256(await raw(p))) !== h)
      throw Error(`Stale original mesh material input: ${p}`);
for (const b of native.originalBlocks)
  if (
    !Number.isSafeInteger(b.rva) ||
    !Number.isSafeInteger(b.size) ||
    b.rva < 0 ||
    b.size < 1 ||
    b.rva + b.size > image.length ||
    (await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256
  )
    throw Error("Original mesh material instruction differs");
const graphRef = systems.systems[native.effectId],
  graph = await read(
    `${cache}/public/latest-vfx-system-assets/${graphRef.file}`,
  );
if (
  inputs[
    resolve(`${cache}/public/latest-vfx-system-assets/${graphRef.file}`)
  ] !== graphRef.sha256
)
  throw Error("Exact native root graph required");
const definitionRef = manifest.definitions[native.effectId],
  definition = await read(
    `${cache}/public/latest-effects/${definitionRef.file}`,
  );
if (
  inputs[resolve(`${cache}/public/latest-effects/${definitionRef.file}`)] !==
  definitionRef.sha256
)
  throw Error("Exact authored mesh source required");
const legacy = await read(`${cache}/research/vfx-meshes-native.json`),
  legacyProof = await read(`${cache}/research/vfx-meshes-inspection.json`);
if (
  legacyProof.mismatchCount !== 0 ||
  legacyProof.observationSha256 !==
    inputs[resolve(`${cache}/research/vfx-meshes-native.json`)]
)
  throw Error("Original 513 SCB proof required");
const oldRoot = legacy.cases.find((c) => c.effectId === native.effectId);
const emitters = [];
async function shader(program, stage, path) {
  const candidates = Object.values(native.shaders).filter(
    (s) => s.glHandle === program[stage],
  );
  if (candidates.length !== 1)
    throw Error("Unique native mesh shader stage required");
  const s = candidates[0],
    ref = s.translation;
  if (
    !s.compiled ||
    s.stage !== stage ||
    s.path.toLowerCase() !== path.toLowerCase()
  )
    throw Error("Native mesh shader path differs");
  const bytes = await raw(`${cache}/public/latest-shaders/${ref.file}`);
  if ((await sha256(bytes)) !== ref.sha256 || bytes.length !== ref.bytes)
    throw Error("Native mesh shader translation differs");
  const file = `shaders/${ref.sha256}.json`;
  await Bun.write(`${folder}/${file}`, bytes);
  return {
    ...ref,
    file,
    path: s.path,
    defines: s.defines,
    permutationDefines: s.permutationDefines,
    permutationHash: s.permutationHash,
  };
}
async function texture(binding) {
  const t = native.textures[binding.nativeTexture];
  if (
    !t?.gpuBytesVerified ||
    t.kind !== "2d" ||
    t.nativeFormat !== 2 ||
    t.layers !== 1 ||
    t.preparedLevels.length !== t.mips ||
    JSON.stringify(binding.sampler.parameters) !==
      JSON.stringify(binding.sampler.queriedParameters)
  )
    throw Error("Verified original mesh texture/sampler required");
  for (const [mip, level] of t.preparedLevels.entries()) {
    if (level.length !== 1)
      throw Error("Native mesh texture layer count differs");
    for (const p of level) {
      const bytes = await raw(`${folder}/${p.file}`),
        actual = t.readbacks.find((r) => r.mip === mip && r.layer === p.layer);
      if (
        p.mip !== mip ||
        p.layer !== 0 ||
        p.width !== Math.max(1, t.width >> mip) ||
        p.height !== Math.max(1, t.height >> mip) ||
        bytes.length !== p.width * p.height * 4 ||
        bytes.length !== p.bytes ||
        (await sha256(bytes)) !== p.sha256 ||
        actual.sha256 !== p.sha256 ||
        actual.bytes !== p.bytes
      )
        throw Error("Original mesh texture pixels differ");
    }
  }
  return {
    name: binding.name,
    stage: binding.stage,
    glslName: binding.glslName,
    unit: binding.unit,
    sampler: binding.sampler,
    kind: "2d",
    pixelFormat: "RGBA8",
    width: t.width,
    height: t.height,
    levels: t.preparedLevels,
  };
}
for (const owner of native.ownership.actors.filter(
  (a) => a.primitiveVtableRva === 0x23f6a80,
)) {
  const source =
      definition.definition.complexEmitterDefinitionData[owner.emitterIndex],
    primitive = source.primitive;
  if (
    primitive.__type !== "VfxPrimitiveMesh" ||
    primitive.mMesh.__type !== "VfxMeshDefinitionData"
  )
    throw Error("Exact static mesh source required");
  const path = primitive.mMesh.mSimpleMeshName.toLowerCase(),
    matches = native.staticMeshSetups.filter((m) => m.path === path);
  if (matches.length !== 1) throw Error("Unique native mesh setup required");
  const setup = matches[0],
    buffer = native.meshBuffers.find(
      (b) => b.nativePointer === setup.nativeBuffer,
    ),
    layout = native.meshLayouts.find(
      (l) => l.nativePointer === setup.nativeLayout,
    );
  const oldSetup = oldRoot.staticMeshSetups.find((m) => m.path === path),
    oldBuffer = oldRoot.meshBuffers.find(
      (b) => b.nativePointer === oldSetup?.nativeBuffer,
    );
  const bytes = Uint8Array.fromHex(buffer.bytesHex),
    hash = await sha256(bytes);
  if (
    !buffer.gpuBytesVerified ||
    buffer.gpuReadbackSha256 !== hash ||
    oldBuffer?.bytesHex !== buffer.bytesHex ||
    bytes.length !== setup.triangles * 3 * 36 ||
    layout.nativeDescriptorHex !==
      "0000030001000000020003000100000003010400010000000800020001000000" ||
    layout.bindings.length !== 4 ||
    layout.bindings.some(
      (b, i) =>
        b.semantic !== [0, 2, 3, 8][i] ||
        b.offset !== [0, 12, 24, 28][i] ||
        b.stride !== 36 ||
        b.nativeBuffer !== setup.nativeBuffer,
    )
  )
    throw Error("Original 36-byte SCB buffer/layout differs");
  const vertices = {
    file: `vertices/${hash}.bin`,
    sha256: hash,
    bytes: bytes.length,
  };
  await Bun.write(`${folder}/${vertices.file}`, bytes);
  const material = native.passes.actors.find(
    (a) => a.emitterIndex === owner.emitterIndex,
  );
  if (material.link !== owner.link || !native.passes.lookupReadOnly)
    throw Error("Original mesh actor/pass ownership differs");
  const rows = [];
  for (const row of material.rows) {
    const variants = [];
    for (const v of row.variants) {
      const p = native.pipelines[v.nativePipeline],
        b = native.bindings[v.nativeBinding],
        program = native.programs[v.nativeProgram];
      if (
        !p.created ||
        !program.linked ||
        !b.created ||
        p.nativeProgram !== v.nativeProgram ||
        p.glProgram !== program.glHandle ||
        b.glProgram !== program.glHandle
      )
        throw Error(
          "Original mesh material pipeline ownership/GPU state differs",
        );
      assert.deepEqual(
        p.state,
        p.validation.state,
        "Native mesh pipeline GPU state differs",
      );
      const constantBuffers = b.uniformBuffers;
      for (const c of constantBuffers)
        if (
          !c.gpuBytesVerified ||
          (await sha256(Uint8Array.fromHex(c.bytesHex))) !== c.gpuReadbackSha256
        )
          throw Error("Native mesh constants differ from GPU readback");
      variants.push({
        index: v.index,
        shaders: {
          vertex: await shader(program, "vertex", v.vertexPath),
          pixel: await shader(program, "pixel", v.pixelPath),
        },
        constantBuffers,
        textures: await Promise.all(b.textures.map(texture)),
        pipeline: { descriptorHex: p.descriptorHex, state: p.state },
        requiredScene: {
          blocks: b.requiredSceneBlocks,
          textures: b.requiredSceneTextures,
          dataBuffers: b.requiredSceneDataBuffers,
        },
      });
    }
    rows.push({ index: row.index, name: row.name, hash: row.hash, variants });
  }
  emitters.push({
    effectId: native.effectId,
    emitterIndex: owner.emitterIndex,
    sourceDefinitionSha256: definitionRef.sha256,
    primitiveVtableRva: owner.primitiveVtableRva,
    authoredPass: Object.hasOwn(source, "pass") ? source.pass : null,
    authoredGroundLayer: Object.hasOwn(source, "isGroundLayer")
      ? source.isGroundLayer
      : null,
    mesh: {
      path,
      triangles: setup.triangles,
      stride: 36,
      vertices,
      descriptorHex: layout.nativeDescriptorHex,
    },
    rows,
    aliases: material.aliases,
  });
}
if (!emitters.length)
  throw Error("No exact original static mesh materials prepared");
const result = {
  schema: 1,
  kind: "prepared-direct-static-mesh-materials",
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  effectsManifestSha256: await sha256(manifestBytes),
  activationInputs: native.activationInputs,
  inputs,
  emitters,
  scope: {
    staticBuildAssetsOnly: true,
    originalMeshNormalsAndColorRetained: true,
    allObservedPassesPreserved: true,
    sceneAnd208ByteInstanceInputsSupplied: false,
    perFrameMaterialUpdatesTranslated: false,
    gpuDrawSubmitted: false,
    runtimeAdmissionChanged: false,
  },
};
const packageBytes = new TextEncoder().encode(JSON.stringify(result, null, 2)),
  packageHash = await sha256(packageBytes);
const bridge = await createLatestDirectStaticMeshMaterials({
  profile,
  packageBytes,
  expectedPackageSha256: packageHash,
  effectsManifestBytes: manifestBytes,
});
let prepared = 0,
  first,
  individual;
for (const emitter of bridge.inventory())
  for (const row of emitter.rows)
    for (const [variantIndex] of row.variants.entries()) {
      const token = await bridge.prepare({
        ...emitter,
        passHash: row.hash,
        variantIndex,
        loadBytes: (file) => raw(`${folder}/${file}`),
      });
      first ??= { token, emitter, variant: row.variants[variantIndex] };
      if (
        emitter.effectId === individualNative.effectId &&
        emitter.emitterIndex === individualNative.emitterIndex &&
        row.hash === individualNative.selectedMaterial.passHash &&
        variantIndex === 0
      )
        individual = { token, emitter, variant: row.variants[variantIndex] };
      const missing = bridge.bind(token, {});
      assert.equal(missing.status, "unresolved-static-mesh-inputs");
      assert.ok(
        missing.omissions.includes(
          "scene:data-buffer:ParticleMeshInstanceInfo_SharedDataBuffer",
        ),
      );
      assert.throws(() => bridge.bind(structuredClone(token), {}), /Owned/);
      prepared++;
    }
const supplied = {
  uniforms: {},
  textures: {},
  dataBuffers: {},
  stencilReference: 0,
  blendColor: [0, 0, 0, 0],
};
for (const block of first.variant.requiredScene.blocks)
  for (const member of block.requiredMembers) {
    const bytes = new Uint8Array(Math.ceil(member.size / 16) * 16);
    if (["mProj", "mWorld"].includes(member.name))
      bytes.set(
        new Uint8Array(
          new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
            .buffer,
        ),
      );
    supplied.uniforms[member.name] = bytes;
  }
for (const t of first.variant.requiredScene.textures)
  supplied.textures[t.name] = {
    dimension: "texture2d",
    width: 1,
    height: 1,
    rgba: new Uint8Array([255, 255, 255, 255]),
    samplerDescriptorHex: "01010100000000000100010100000000",
    samplerParameters: { 10240: 9729, 10241: 9729, 10242: 33071, 10243: 33071 },
    inputPolicy: "explicit-diagnostic-no-match-scene-claim",
  };
for (const b of first.variant.requiredScene.dataBuffers)
  supplied.dataBuffers[b.name] = {
    elementBytes: 208,
    bytes: new Uint8Array(208),
    inputPolicy: "opaque-supplied-unit-record-no-instance-semantics-claim",
  };
const bound = bridge.bind(first.token, supplied);
assert.equal(bound.status, "bound-explicit-input-static-mesh-material");
assert.ok(bound.uniforms.length > 0);
const firstByte = bound.vertices[0];
bound.vertices[0] ^= 255;
bound.stages[0].sidecar.attributes.length = 0;
assert.equal(bridge.bind(first.token, supplied).vertices[0], firstByte);
assert.ok(
  bridge.bind(first.token, supplied).stages[0].sidecar.attributes.length > 0,
);
assert.notEqual(
  bound.dataBuffers.ParticleMeshInstanceInfo_SharedDataBuffer.bytes.buffer,
  supplied.dataBuffers.ParticleMeshInstanceInfo_SharedDataBuffer.bytes.buffer,
);
result.controls = {
  allObservedMeshVariantsPrepared: prepared,
  missingSceneAndInstanceReported: true,
  foreignHandlesRejected: true,
  explicitDiagnosticBinding: true,
  packedConstantBlocks: bound.uniforms.length,
  copiedVerticesShadersAndInstanceBytes: true,
  gpuExecuted: false,
};
assert.ok(individual, "Original individual mesh pass required");
assert.equal(isLatestDirectStaticMeshMaterials(bridge), true);
assert.equal(isLatestDirectStaticMeshMaterials({ ...bridge }), false);
const approvedSelection = bridge.inspectNonInstanced(individual.token);
assert.equal(
  approvedSelection.sourceDefinitionSha256,
  individual.emitter.sourceDefinitionSha256,
);
assert.equal(
  approvedSelection.vertexSha256,
  individual.emitter.mesh.vertices.sha256,
);
assert.equal(approvedSelection.scope.runtimeActivationApproved, false);
assert.throws(
  () => bridge.inspectNonInstanced(structuredClone(individual.token)),
  /Owned/,
);
approvedSelection.pipeline.state = null;
assert.ok(bridge.inspectNonInstanced(individual.token).pipeline.state);
const fromHex = (hex) => {
  const bytes = Uint8Array.fromHex(hex);
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4,
  ).slice();
};
const current = Object.fromEntries(
  individualNative.selectedMaterial.currentCpuParameters.map((p) => [
    p.name,
    p.bytesHex,
  ]),
);
const drawParameters = {
  mWorld: fromHex(individualNative.beforeMaterialApply.mWorld),
  kColorFactor: fromHex(current.kColorFactor),
  vParticleUVTransform: fromHex(current.vParticleUVTransform),
  COLOR_LOOKUP_UV: fromHex(current.COLOR_LOOKUP_UV),
  DYNAMIC_MESH_CENTER: fromHex(
    individualNative.beforeMaterialApply.DYNAMIC_MESH_CENTER,
  ).slice(0, 3),
};
const individualScene = structuredClone(supplied);
individualScene.dataBuffers = {};
for (const name of [
  ...Object.keys(drawParameters),
  "USE_INSTANCE_DRAW",
  "INSTANCE_OFFSET",
])
  delete individualScene.uniforms[name];
for (const block of individual.variant.requiredScene.blocks)
  for (const member of block.requiredMembers) {
    if (
      Object.hasOwn(drawParameters, member.name) ||
      ["USE_INSTANCE_DRAW", "INSTANCE_OFFSET"].includes(member.name)
    )
      continue;
    const actual = individualNative.beforeMaterialApply[member.name];
    individualScene.uniforms[member.name] = actual
      ? Uint8Array.fromHex(actual)
      : new Uint8Array(Math.ceil(member.size / 16) * 16);
  }
const individualArgs = {
  drawParameters,
  matrixOrder: "post-1916f70",
  individualMode: 0,
  scene: individualScene,
};
const individualBound = bridge.bindNonInstanced(
  individual.token,
  individualArgs,
);
assert.equal(individualBound.status, "bound-noninstanced-static-mesh-inputs");
assert.equal(individualBound.scope.conditional208PayloadRequired, false);
assert.equal(individualBound.inactiveApiBindings.payloadRecovered, false);
assert.equal(individualBound.inactiveApiBindings.dataBuffers.length, 1);
assert.equal(
  individualBound.inactiveApiBindings.dataBuffers[0].inactiveApiBindingRequired,
  true,
);
assert.deepEqual(individualBound.dataBuffers, {});
assert.equal(
  individualBound.drawValues.mWorld.toHex(),
  individualNative.beforeMaterialApply.mWorld,
);
for (const update of individualBound.constantUpdates)
  assert.equal(
    update.bytesHex,
    current[update.name],
    "Original current CPU material overlay differs",
  );
for (const snapshot of individualProof.stageUniformSnapshots.filter(
  (s) => s.complete,
)) {
  const packed = individualBound.uniforms.find(
    (b) => b.stage === snapshot.stage && b.name === snapshot.name,
  );
  assert.ok(packed, `Packed original mesh block missing: ${snapshot.name}`);
  assert.equal(
    packed.bytes.toHex(),
    snapshot.bytesHex,
    "Complete original CPU block packing differs",
  );
}
assert.throws(
  () =>
    bridge.bindNonInstanced(structuredClone(individual.token), individualArgs),
  /Owned/,
);
assert.throws(
  () =>
    bridge.bindNonInstanced(individual.token, {
      ...individualArgs,
      individualMode: 1,
    }),
  /mode zero/,
);
assert.throws(
  () =>
    bridge.bindNonInstanced(individual.token, {
      ...individualArgs,
      matrixOrder: "raw",
    }),
  /post-setter/,
);
assert.throws(
  () =>
    bridge.bindNonInstanced(individual.token, {
      ...individualArgs,
      scene: { ...individualScene, dataBuffers: supplied.dataBuffers },
    }),
  /invented208/,
);
assert.throws(
  () =>
    bridge.bindNonInstanced(individual.token, {
      ...individualArgs,
      scene: {
        ...individualScene,
        uniforms: {
          ...individualScene.uniforms,
          mWorld: individualBound.drawValues.mWorld,
        },
      },
    }),
  /overrides/,
);
assert.ok(
  bridge
    .bind(individual.token, individualScene)
    .omissions.includes(
      "scene:data-buffer:ParticleMeshInstanceInfo_SharedDataBuffer",
    ),
);
result.controls.individual = {
  originalShaderBranchAndMode: true,
  postSetterMatrixUnchanged: true,
  originalCpuMaterialOverlays: individualBound.constantUpdates,
  completeNativeCpuBlocksCompared: individualProof.stageUniformSnapshots.filter(
    (s) => s.complete,
  ).length,
  foreignAndWrongModeAndSceneOverrideRejected: true,
  active208PayloadStillRequiredByNormalPath: true,
  inactiveApiBindingProofRequired: true,
  inactiveApiBindingProven: false,
  instance208PayloadRecovered: false,
  sceneInputsExplicitDiagnostic: true,
  gpuExecuted: false,
};
// Loaded output resources are evidence inputs too; serialize the final closure.
const finalBytes = new TextEncoder().encode(JSON.stringify(result, null, 2));
await createLatestDirectStaticMeshMaterials({
  profile,
  packageBytes: finalBytes,
  expectedPackageSha256: await sha256(finalBytes),
  effectsManifestBytes: manifestBytes,
});
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Final static mesh preparation drift");
await Bun.write(`${folder}/package.json`, finalBytes);
console.log(
  JSON.stringify({
    output: `${folder}/package.json`,
    sha256: await sha256(finalBytes),
    emitters: emitters.length,
    variants: prepared,
    inputs: Object.keys(inputs).length,
    runtimeAdmissionChanged: false,
    gpuDrawSubmitted: false,
  }),
);
