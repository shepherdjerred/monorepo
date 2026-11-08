import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Mesh draw evidence drift");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  native = await read(`${cache}/research/direct-mesh-draw-branch-native.json`),
  shaders = await read(`${cache}/public/latest-shaders/package.json`);
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(native.schema, 1);
assert.equal(native.kind, "original-individual-static-mesh-draw-branch");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.effectId, "champions/hecarim/0/e57b8289");
assert.equal(native.emitterIndex, 15);
assert.equal(native.particleCount, 1);
assert.equal(native.materialApplyCallerRva, 0x1809c7b);
assert.equal(native.scope.recordingGraphicsDeviceUniformApi, true);
assert.equal(native.scope.gpuMaterialUniformUpdatesApplied, false);
assert.equal(native.scope.materialApplyAndGpuDrawExecuted, false);
assert.equal(native.scope.instance208BytePayloadProduced, false);
assert.equal(native.tickTimes.length, 4);
assert.ok(
  native.originalBlocks.length &&
    Object.keys(native.inputs).length &&
    Object.keys(native.sources).length,
);
for (const map of [native.inputs, native.sources])
  for (const [path, hash] of Object.entries(map))
    assert.equal(
      await sha256(await raw(path)),
      hash,
      `Native source/input changed: ${path}`,
    );
for (const b of native.originalBlocks) {
  assert.ok(
    Number.isSafeInteger(b.rva) &&
      Number.isSafeInteger(b.size) &&
      b.rva >= 0 &&
      b.size > 0 &&
      b.rva + b.size <= image.length,
  );
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
}
const zero = "00".repeat(16),
  one = "01000000" + "00".repeat(12);
assert.equal(native.initial.USE_INSTANCE_DRAW, zero);
assert.equal(native.batched.values.USE_INSTANCE_DRAW, one);
assert.equal(native.cleaned.USE_INSTANCE_DRAW, zero);
assert.equal(native.cleaned.INSTANCE_OFFSET, zero);
assert.equal(native.beforeMaterialApply.USE_INSTANCE_DRAW, zero);
assert.equal(native.beforeMaterialApply.INSTANCE_OFFSET, zero);
const selected = native.selectedMaterial;
assert.equal(selected.passHash, 1047222492);
assert.equal(selected.initialGpuBinding.sceneInputsBound, false);
const names = new Set([
  "vParticleUVTransform",
  "kColorFactor",
  "COLOR_LOOKUP_UV",
]);
assert.equal(native.observedUniformUpdates.length, names.size);
for (const u of native.observedUniformUpdates) {
  assert.ok(names.delete(u.name));
  assert.equal(u.binding, selected.nativeBinding);
  assert.equal(u.gpuApplied, false);
  assert.equal(u.count, u.name === "vParticleUVTransform" ? 3 : 1);
  assert.equal(u.bytesHex.length, u.count * 32);
  assert.equal(
    selected.currentCpuParameters.find((p) => p.name === u.name)?.bytesHex,
    u.bytesHex,
  );
}
const color = Uint8Array.fromHex(
    native.observedUniformUpdates.find((p) => p.name === "kColorFactor")
      .bytesHex,
  ),
  cv = new DataView(color.buffer);
assert.ok([0, 4, 8].some((offset) => cv.getFloat32(offset, true) > 0));
const snapshots = [],
  pending = [],
  selections = [];
for (const stage of ["vertex", "pixel"]) {
  const selectedShader = selected.shaders[stage],
    candidate = shaders.stages.find(
      (s) => s.file === selectedShader.path.toLowerCase() && s.stage === stage,
    );
  assert.ok(candidate);
  assert.ok(!candidate.baseDefines.some((d) => /instanc/i.test(d.name)));
  const keyDefines = selectedShader.defines.filter((d) =>
    candidate.baseDefines.some((b) => b.name === d.name),
  );
  assert.deepEqual(selectedShader.permutationDefines, keyDefines);
  const permutation = candidate.permutations.find(
    (p) => p.hash === selectedShader.permutationHash,
  );
  assert.equal(permutation?.id, selectedShader.recordId);
  const record = candidate.records.find((p) => p.id === permutation.id);
  assert.equal(record.dxbcSha256, selectedShader.translation.dxbcSha256);
  const ref = selectedShader.translation,
    bytes = await raw(`${cache}/public/latest-shaders/${ref.file}`);
  assert.equal(await sha256(bytes), ref.sha256);
  assert.equal(bytes.length, ref.bytes);
  const shader = JSON.parse(new TextDecoder().decode(bytes));
  const instanceBlocks = shader.sidecar.blocks.filter((b) =>
    b.members.some((m) => m.name === "USE_INSTANCE_DRAW"),
  );
  assert.equal(instanceBlocks.length, 1);
  const instanceFlag = instanceBlocks[0].members.find(
    (m) => m.name === "USE_INSTANCE_DRAW",
  );
  assert.equal(instanceFlag.scalar, "uint");
  assert.equal(instanceFlag.size, 4);
  assert.equal(instanceFlag.offset, stage === "vertex" ? 44 : 16);
  selections.push({
    stage,
    path: selectedShader.path,
    defines: selectedShader.defines,
    permutationHash: selectedShader.permutationHash,
    recordId: selectedShader.recordId,
    translation: ref,
    instanceFlag: {
      block: instanceBlocks[0].glslName,
      ...instanceFlag,
      originalSharedBytesHex: zero,
    },
  });
  for (const block of shader.sidecar.blocks) {
    if (
      !block.members.some((m) => m.used) ||
      shader.sidecar.textures.some(
        (t) => t.name === block.name && t.dimension === "buffer",
      )
    )
      continue;
    const captured = selected.initialGpuBinding.uniformBuffers.find(
      (b) => b.stage === stage && b.name === block.glslName,
    );
    const packed = captured
        ? Uint8Array.fromHex(captured.bytesHex)
        : new Uint8Array(block.size),
      members = [],
      missing = [];
    for (const member of block.members.filter((m) => m.used)) {
      const material = selected.currentCpuParameters.find(
          (p) => p.name === member.name,
        ),
        shared = native.beforeMaterialApply[member.name];
      const hex = material?.bytesHex ?? shared;
      if (hex !== undefined) {
        const value = Uint8Array.fromHex(hex);
        assert.ok(value.length >= member.size);
        packed.set(value.subarray(0, member.size), member.offset);
        members.push({
          name: member.name,
          offset: member.offset,
          size: member.size,
          bytesHex: hex,
          source: material
            ? "original-current-material-cpu-vectors"
            : "original-shared-parameter-setters",
        });
      } else if (captured)
        members.push({
          name: member.name,
          offset: member.offset,
          size: member.size,
          bytesHex: Buffer.from(
            packed.subarray(member.offset, member.offset + member.size),
          ).toString("hex"),
          source: "original-static-gpu-initialization",
        });
      else {
        missing.push(member.name);
        pending.push(`${stage}:${block.glslName}:${member.name}`);
      }
    }
    snapshots.push({
      stage,
      name: block.glslName,
      size: block.size,
      complete: missing.length === 0,
      bytesHex: missing.length ? null : Buffer.from(packed).toString("hex"),
      members,
      missingMembers: missing,
    });
  }
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final mesh branch proof drift",
  );
const output = `${cache}/research/direct-mesh-draw-branch-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-individual-mesh-shader-branch-comparison",
      inputs,
      originalInstanceFlag: 0,
      selectedPassHash: selected.passHash,
      shaderSelections: selections,
      stageUniformSnapshots: snapshots,
      unresolvedFrameInputs: pending,
      counts: {
        originalFlagStatesChecked: 6,
        shaderStages: 2,
        completeUniformBlocks: snapshots.filter((s) => s.complete).length,
        partialUniformBlocks: snapshots.filter((s) => !s.complete).length,
        nativeMaterialUpdates: 3,
      },
      scope: {
        nativeIndividualMeshPrefixExecuted: true,
        originalSharedInstancingDisabled: true,
        noInstancingPermutationKey: true,
        sourceSelectedShadersRetained: true,
        uniformSnapshotsAreReflectedPackingOfOriginalCpuBytes: true,
        gpuUpdatedUniformParity: false,
        inactiveUsamplerApiBindingProven: false,
        instance208PayloadProduced: false,
        sceneResourcesRecovered: false,
        runtimeAdmissionChanged: false,
        browserExecuted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    inputs: Object.keys(inputs).length,
    completeBlocks: snapshots.filter((s) => s.complete).length,
    unresolvedFrameInputs: pending,
  }),
);
