import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { normalizeDirectPointEmitter } from "../latest-direct-effect-defaults.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Static mesh renderer input drift");
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const rendererEntry = resolve(
  import.meta.dir,
  "../latest-direct-static-mesh-renderer.mjs",
);
await captureDirectSourceInputs(
  [
    rendererEntry,
    resolve(import.meta.dir, "../latest-direct-static-mesh-package.mjs"),
  ],
  raw,
);
await raw(`${cache}/public/vendor/three.module.js`);
const built = await Bun.build({
  entrypoints: ["mesh-control-entry"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(build) {
        build.onResolve({ filter: /^mesh-control-entry$/ }, () => ({
          path: "entry",
          namespace: "mesh-control",
        }));
        build.onLoad({ filter: /.*/, namespace: "mesh-control" }, () => ({
          contents: `export {LatestDirectStaticMeshRenderer} from ${JSON.stringify(rendererEntry.replaceAll("\\", "/"))}; export {loadLatestDirectStaticMeshPackage} from ${JSON.stringify(resolve(import.meta.dir, "../latest-direct-static-mesh-package.mjs").replaceAll("\\", "/"))};`,
          loader: "js",
        }));
        build.onResolve({ filter: /^three$/ }, () => ({
          path: `${cache}/public/vendor/three.module.js`,
        }));
      },
    },
  ],
});
if (!built.success || built.outputs.length !== 1)
  throw new AggregateError(built.logs, "Static mesh renderer bundle failed");
const bundlePath = `${cache}/research/direct-static-mesh-renderer.bundle.mjs`;
await Bun.write(bundlePath, built.outputs[0]);
await raw(bundlePath);
const { LatestDirectStaticMeshRenderer, loadLatestDirectStaticMeshPackage } =
  await import(pathToFileURL(bundlePath).href);
const THREE = await import(
  pathToFileURL(`${cache}/public/vendor/three.module.js`).href
);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const native = await read(
    `${cache}/research/direct-mesh-draw-branch-native.json`,
  ),
  ref = manifest.definitions[native.effectId],
  record = await read(`${cache}/public/latest-effects/${ref.file}`);
assert.equal(
  inputs[resolve(`${cache}/public/latest-effects/${ref.file}`)],
  ref.sha256,
);
const packageData = await loadLatestDirectStaticMeshPackage({
  load: (file) => raw(`${cache}/public/${file}`),
  profile,
  manifestBytes,
  records: [{ id: native.effectId, definition: record.definition }],
});
const capability = packageData.programs.compile(
  normalizeDirectPointEmitter(
    record.definition.complexEmitterDefinitionData[native.emitterIndex],
  ),
);
assert.equal(capability.status, "prepared-static-mesh-primitive-program");
const program = {
  index: native.emitterIndex,
  primitive: "static-mesh",
  materialKey: `${native.effectId}:${native.emitterIndex}`,
  meshProgram: capability.program,
};
const definitions = new Map([
  [
    native.effectId,
    { id: native.effectId, definitionHash: ref.sha256, emitters: [program] },
  ],
]);
const world = new THREE.Group(),
  submitted = [];
const renderer = new LatestDirectStaticMeshRenderer(world, packageData, {
  onSubmit: (row) => submitted.push(row),
});
await renderer.loadDefinitions(definitions);
const camera = new THREE.PerspectiveCamera(60, 1, 1, 100000);
camera.position.set(0, 1000, 0);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const bytes = new Uint8Array(352),
  view = new DataView(bytes.buffer);
for (let p = 0; p < 2; p++) {
  const base = p * 176;
  for (const i of [0, 5, 10, 15]) view.setFloat32(base + i * 4, 1, true);
  view.setFloat32(base + 0x60, 2, true);
  view.setFloat32(base + 0x6c, 1, true);
  view.setFloat32(base + 0x70, -0.5, true);
  for (let i = 0; i < 4; i++)
    view.setFloat32(base + 0x90 + i * 4, (p + 1) / 2, true);
  view.setFloat32(base + 0xa4, 1, true);
}
const draw = {
  primitive: "static-mesh",
  definitionId: native.effectId,
  emitterId: native.emitterIndex,
  materialKey: program.materialKey,
  sourceEventId: "supplied-renderer-contract-control",
  generation: 1,
  ownerId: null,
  particleCount: 2,
  meshRecords: bytes,
  indices: new Uint16Array(),
};
renderer.commit({ time: 1, draws: [draw] }, camera);
assert.equal(renderer.meshes.size, 2);
const meshes = [...renderer.meshes.values()];
assert.equal(meshes[0].geometry, meshes[1].geometry);
assert.equal(meshes[0].geometry.index.count, 480);
assert.equal(meshes[0].geometry.index.array[479], 479);
assert.notEqual(meshes[0].material, meshes[1].material);
assert.notEqual(
  meshes[0].userData.blocks[0].group,
  meshes[1].userData.blocks[0].group,
);
const inactive =
  meshes[0].material.uniforms.ParticleMeshInstanceInfo_SharedDataBuffer.value;
for (const mesh of meshes) {
  assert.ok(mesh.material.uniforms.TEXTURE_TX.value.isDataTexture);
  assert.ok(
    mesh.material.uniforms.PARTICLE_COLOR_TEXTURE_TX.value.isDataTexture,
  );
  assert.equal(Object.hasOwn(mesh.material.uniforms, "TEXTURE__TX"), false);
  assert.equal(
    Object.hasOwn(mesh.material.uniforms, "PARTICLE_COLOR_TEXTURE__TX"),
    false,
  );
  assert.equal(Object.values(mesh.material.uniforms).length, 5);
}
assert.equal(inactive.image.width, 52);
assert.equal(inactive.image.height, 1);
assert.equal(inactive.internalFormat, "R32UI");
assert.equal(inactive.format, THREE.RedIntegerFormat);
assert.equal(meshes[0].material.side, THREE.FrontSide);
world.scale.x = -1;
renderer.commit({ time: 1, draws: [draw] }, camera);
assert.equal(meshes[0].material.side, THREE.BackSide);
world.scale.x = 0;
assert.throws(
  () => renderer.commit({ time: 1, draws: [draw] }, camera),
  /Nonsingular/,
);
world.scale.x = 1;
renderer.commit({ time: 1, draws: [draw] }, camera);
meshes.forEach((m) => m.onAfterRender());
assert.equal(submitted.length, 2);
renderer.setEnabled(false);
meshes.forEach((m) => m.onAfterRender());
assert.equal(submitted.length, 2);
renderer.setEnabled(true);
const before = meshes.map((m) =>
  m.userData.blocks.map((b) => new Uint8Array(b.data.buffer).toHex()),
);
assert.throws(
  () =>
    renderer.commit(
      { time: 2, draws: [draw, { ...draw, meshRecords: new Uint8Array(1) }] },
      camera,
    ),
  /malformed/,
);
assert.deepEqual(
  meshes.map((m) =>
    m.userData.blocks.map((b) => new Uint8Array(b.data.buffer).toHex()),
  ),
  before,
);
assert.throws(
  () => renderer.commit({ time: 2, draws: [draw, draw] }, camera),
  /Duplicate/,
);
assert.throws(
  () =>
    renderer.commit({ time: 2, draws: [{ ...draw, ownerId: 123 }] }, camera),
  /owner changed/,
);
renderer.commit({ time: 2, draws: [{ ...draw, generation: 2 }] }, camera);
assert.equal(renderer.meshes.size, 2);
renderer.commit({ time: 0, draws: [] }, camera);
assert.equal(renderer.meshes.size, 0);
renderer.dispose();
assert.equal(world.children.length, 0);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final static mesh renderer drift",
  );
const output = `${cache}/research/direct-static-mesh-renderer-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-three-static-mesh-consumer-control",
      inputs,
      controls: {
        actualOwnedMaterialFactory: true,
        actualThreeObjects: true,
        sharedStaticGeometry: true,
        independentParticleMaterialsAndBlocks: true,
        exactR32uiInactiveApiTexture: true,
        exactTranslatedTextureSamplerAliases: true,
        nativeClockwiseCullMapping: true,
        completePacketPreflight: true,
        sourceGenerationOwnership: true,
        disableAndRemoval: true,
      },
      scope: {
        staticAssetFixture: true,
        supplied176ByteRecords: true,
        emitterRuntimeExecuted: false,
        threeGpuExecution: false,
        browserExecuted: false,
        actualReplayActivation: false,
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
    particles: 2,
    blocksPerParticle: 7,
    browserExecuted: false,
  }),
);
