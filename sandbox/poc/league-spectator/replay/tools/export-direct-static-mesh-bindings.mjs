import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestDirectStaticMeshMaterials } from "../latest-direct-static-mesh-materials.mjs";
import { directStaticMeshDrawParameters } from "../latest-direct-effect-mesh-record.mjs";
import { directNativeMetalRasterToGles } from "../latest-native-raster-conventions.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const directory = `${cache}/research/direct-static-mesh-materials`,
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Mesh binding input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const packageBytes = await raw(`${directory}/package.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  native = await read(`${cache}/research/direct-mesh-draw-branch-native.json`),
  proof = await read(
    `${cache}/research/direct-mesh-draw-branch-comparison.json`,
  );
assert.equal(proof.kind, "original-individual-mesh-shader-branch-comparison");
assert.equal(proof.originalInstanceFlag, 0);
assert.equal(proof.scope.nativeIndividualMeshPrefixExecuted, true);
assert.equal(native.build, profile.clientVersion);
for (const evidence of [
  JSON.parse(new TextDecoder().decode(packageBytes)),
  native,
  proof,
])
  for (const map of [evidence.inputs, evidence.sources ?? {}])
    for (const [path, hash] of Object.entries(map))
      assert.equal(
        await sha256(await raw(path)),
        hash,
        "Original mesh input differs",
      );
const bridge = await createLatestDirectStaticMeshMaterials({
  profile,
  packageBytes,
  expectedPackageSha256: await sha256(packageBytes),
  effectsManifestBytes: manifestBytes,
});
const emitter = bridge
  .inventory()
  .find(
    (e) =>
      e.effectId === native.effectId && e.emitterIndex === native.emitterIndex,
  );
assert.ok(emitter);
const row = emitter.rows.find((r) => r.hash === proof.selectedPassHash);
assert.equal(row.variants.length, 1);
const token = await bridge.prepare({
  effectId: emitter.effectId,
  emitterIndex: emitter.emitterIndex,
  passHash: row.hash,
  variantIndex: 0,
  loadBytes: (file) => raw(`${directory}/${file}`),
});
const current = Object.fromEntries(
  native.selectedMaterial.currentCpuParameters.map((p) => [p.name, p.bytesHex]),
);
const floats = (hex) => {
  const bytes = Uint8Array.fromHex(hex);
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4,
  ).slice();
};
// This assembled record is an adapter control from captured named fields, not a
// claim that the original 176-byte record was captured in this native fixture.
const record = new Uint8Array(176),
  rv = new DataView(record.buffer),
  world = floats(native.beforeMaterialApply.mWorld);
for (let i = 0; i < 16; i++)
  rv.setFloat32(i * 4, world[(i % 4) * 4 + Math.floor(i / 4)], true);
const uv = floats(current.vParticleUVTransform);
[uv[0], uv[4], uv[1], uv[5], uv[2], uv[6]].forEach((x, i) =>
  rv.setFloat32(0x60 + i * 4, x, true),
);
record.set(Uint8Array.fromHex(current.kColorFactor), 0x90);
record.set(Uint8Array.fromHex(current.COLOR_LOOKUP_UV).subarray(0, 8), 0xa0);
const drawParameters = directStaticMeshDrawParameters({
  record,
  resourceOffset40: [0, 0, 0],
  paletteByte: 0,
  multTexturePresent: false,
});
for (const name of [
  "mWorld",
  "kColorFactor",
  "vParticleUVTransform",
  "COLOR_LOOKUP_UV",
])
  assert.equal(
    new Uint8Array(drawParameters[name].buffer).toHex(),
    name === "mWorld" ? native.beforeMaterialApply[name] : current[name],
    `World helper differs from native named setter: ${name}`,
  );
assert.deepEqual(
  [...drawParameters.DYNAMIC_MESH_CENTER],
  [...floats(native.beforeMaterialApply.DYNAMIC_MESH_CENTER).slice(0, 3)],
);
const prepared = bridge.bind(token, {});
assert.equal(prepared.status, "unresolved-static-mesh-inputs");
const vertices = await raw(`${directory}/${emitter.mesh.vertices.file}`),
  points = [];
for (let at = 0; at < vertices.length; at += 36) {
  const v = new DataView(vertices.buffer, vertices.byteOffset + at, 36),
    p = [
      v.getFloat32(0, true),
      v.getFloat32(4, true),
      v.getFloat32(8, true),
      1,
    ];
  points.push(
    [0, 1, 2].map((i) =>
      p.reduce((sum, x, j) => sum + x * world[i * 4 + j], 0),
    ),
  );
}
const low = [0, 2].map((i) => Math.min(...points.map((p) => p[i]))),
  high = [0, 2].map((i) => Math.max(...points.map((p) => p[i])));
const extent = Math.max(...high.map((x, i) => x - low[i])) * 0.65,
  center = high.map((x, i) => (x + low[i]) / 2);
assert.ok(Number.isFinite(extent) && extent > 0);
const cases = [];
for (const facing of [1, -1]) {
  const projection = new Float32Array(16);
  projection[0] = 1 / extent;
  projection[3] = -center[0] / extent;
  projection[6] = facing / extent;
  projection[7] = (-facing * center[1]) / extent;
  projection[11] = 0.5;
  projection[15] = 1;
  const sceneValues = {
    mProj: projection,
    vCamera: [0, -facing * 10000, 0],
    FOG_OF_WAR_PARAMS: [0.0001, 0.0001, 0.5, 0.5],
    FOG_OF_WAR_ALWAYS_BELOW_Y: [0, 0, 0, 1],
    mCameraForward: [0, facing, 0],
    mCameraUp: [0, 0, facing],
    FOW_EDGE_CONTROL: [0, 0, 0, 1],
    RENDERTARGET_IS_SRGB: [0],
  };
  const scene = {
    uniforms: {},
    textures: {},
    dataBuffers: {},
    stencilReference: 0,
    blendColor: [0, 0, 0, 0],
  };
  const owned = new Set([
    ...Object.keys(drawParameters),
    "USE_INSTANCE_DRAW",
    "INSTANCE_OFFSET",
  ]);
  for (const block of row.variants[0].requiredScene.blocks)
    for (const member of block.requiredMembers) {
      if (owned.has(member.name)) continue;
      if (Object.hasOwn(native.beforeMaterialApply, member.name))
        scene.uniforms[member.name] = Uint8Array.fromHex(
          native.beforeMaterialApply[member.name],
        );
      if (Object.hasOwn(sceneValues, member.name)) {
        const values = sceneValues[member.name],
          bytes = new Uint8Array(Math.ceil(member.size / 16) * 16),
          view = new DataView(bytes.buffer);
        assert.equal(values.length * 4, member.size);
        values.forEach((x, i) =>
          member.scalar === "uint"
            ? view.setUint32(i * 4, x, true)
            : view.setFloat32(i * 4, x, true),
        );
        scene.uniforms[member.name] = bytes;
      }
      assert.ok(
        scene.uniforms[member.name],
        `No explicit scene input: ${member.name}`,
      );
    }
  for (const [name, rgba] of [
    ["FOW_MAP_SharedTexture", [255, 255, 255, 255]],
    ["PIXEL_COLOR_REMAP_RAMP_SharedTexture", [0, 0, 0, 0]],
  ])
    scene.textures[name] = {
      dimension: "texture2d",
      width: 1,
      height: 1,
      rgba: Uint8Array.from(rgba),
      samplerDescriptorHex: "01010100000000000100010100000000",
      samplerParameters: {
        10240: 9729,
        10241: 9729,
        10242: 33071,
        10243: 33071,
      },
      inputPolicy:
        "explicit-diagnostic-white-fog-transparent-remap-no-native-scene-claim",
    };
  const bound = bridge.bindNonInstanced(token, {
    drawParameters,
    matrixOrder: "post-1916f70",
    individualMode: 0,
    scene,
  });
  assert.equal(bound.status, "bound-noninstanced-static-mesh-inputs");
  cases.push({
    diagnosticFacing: facing,
    policy: bound.policy,
    uniformBlocks: bound.uniforms.map((b) => ({
      ...b,
      bytes: undefined,
      bytesHex: b.bytes.toHex(),
    })),
    textures: bound.textures,
    sceneTextures: bound.sceneTextures,
    inactiveApiBindings: bound.inactiveApiBindings,
    pipeline: bound.pipeline,
    glesRaster: directNativeMetalRasterToGles(bound.pipeline, {
      targetViewportOrigin: "lower-left",
      clipY: "unchanged",
    }),
    scope: bound.scope,
  });
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final mesh export drift",
  );
const output = `${cache}/research/direct-static-mesh-bindings.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "factory-noninstanced-static-mesh-bindings",
      inputs,
      selection: {
        effectId: emitter.effectId,
        emitterIndex: emitter.emitterIndex,
        passHash: row.hash,
        variantIndex: 0,
      },
      cases,
      scope: {
        actualFactoryExecuted: true,
        worldDrawParameterHelperMatchedNativeSetters: true,
        assembledRecordAdapterControl: true,
        original176RecordCapturedInThisFixture: false,
        sceneInputs:
          "supplied-diagnostic-two-sided-camera-white-fog-transparent-remap",
        instance208PayloadRecovered: false,
        browserExecuted: false,
        runtimeAdmissionChanged: false,
      },
    },
    (_, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v),
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    inputs: Object.keys(inputs).length,
    cases: cases.length,
    blocks: cases[0].uniformBlocks.length,
  }),
);
