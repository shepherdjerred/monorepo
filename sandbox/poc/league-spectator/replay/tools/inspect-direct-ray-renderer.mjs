import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  folder = `${cache}/public/latest-direct-ray-materials`;
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h)
    throw Error("Ray renderer input drift");
  inputs[path] = h;
  return b;
}
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const files = [
  "latest-direct-ray-renderer.mjs",
  "latest-direct-ray-material-package.mjs",
].map((f) => resolve(import.meta.dir, "..", f));
await captureDirectSourceInputs([import.meta.path, ...files], raw);
await raw(`${cache}/public/vendor/three.module.js`);
const build = await Bun.build({
  entrypoints: ["ray-control"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(b) {
        b.onResolve({ filter: /^ray-control$/ }, () => ({
          path: "entry",
          namespace: "ray-control",
        }));
        b.onLoad({ filter: /.*/, namespace: "ray-control" }, () => ({
          contents: files
            .map(
              (f) =>
                `export * from ${JSON.stringify(f.replaceAll("\\", "/"))};`,
            )
            .join("\n"),
          loader: "js",
        }));
        b.onResolve({ filter: /^three$/ }, () => ({
          path: `${cache}/public/vendor/three.module.js`,
        }));
      },
    },
  ],
});
if (!build.success) throw new AggregateError(build.logs, "Ray bundle failed");
const bundle = `${cache}/research/direct-ray-renderer.bundle.mjs`;
await Bun.write(bundle, build.outputs[0]);
await raw(bundle);
const {
    LatestDirectRayRenderer,
    createLatestDirectRayMaterialPackage,
    DIRECT_RAY_MATERIAL_POLICY,
  } = await import(pathToFileURL(bundle).href),
  THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  bridge = await createLatestDirectRayMaterialPackage({
    profile,
    packageBytes: await raw(`${folder}/package.json`),
    effectsManifestBytes: manifestBytes,
  }),
  bindingEvidence = await read(`${cache}/research/direct-ray-bindings.json`),
  tokens = new Map(),
  definitions = new Map();
for (const [path, h] of Object.entries(bindingEvidence.inputs))
  assert.equal(await sha256(await raw(path)), h, "Binding fixture stale");
const runtimePrograms = [];
for (const e of bridge.inventory()) {
  const token = await bridge.prepare({
      effectId: e.effectId,
      emitterIndex: e.emitterIndex,
      passHash: 2700020711,
      variantIndex: 0,
      loadBytes: (p) => raw(`${folder}/${p}`),
    }),
    selection = bridge.inspect(token),
    ref = manifest.definitions[e.effectId],
    record = await read(`${cache}/public/latest-effects/${ref.file}`),
    source = record.definition.complexEmitterDefinitionData[e.emitterIndex],
    textures = selection.textures,
    p = {
      index: e.emitterIndex,
      primitive: "ray",
      source,
      materialKey: `${e.effectId}:${e.emitterIndex}`,
      materialPolicy: DIRECT_RAY_MATERIAL_POLICY,
      texture: {
        kind: "texture",
        status: "prepared",
        sourceSha256: textures.find((t) => t.name === "TEXTURE__TX")
          .sourceSha256,
      },
      rayPaletteTexture: {
        kind: "texture",
        status: "prepared",
        sourceSha256: textures.find(
          (t) => t.name === "PARTICLE_COLOR_TEXTURE__TX",
        ).sourceSha256,
      },
      rayMaterialSelection: selection,
    };
  tokens.set(p.materialKey, token);
  runtimePrograms.push(p);
  const d = definitions.get(e.effectId) ?? {
    id: e.effectId,
    definitionHash: ref.sha256,
    emitters: [],
  };
  d.emitters.push(p);
  definitions.set(e.effectId, d);
}
const world = new THREE.Group(),
  submitted = [],
  renderer = new LatestDirectRayRenderer(
    world,
    { materials: bridge, tokens },
    { onSubmit: (r) => submitted.push(r) },
  );
await renderer.loadDefinitions(definitions);
const camera = new THREE.PerspectiveCamera(60, 1, 1, 100000);
camera.position.set(300, 900, 1200);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const draws = bindingEvidence.cases.map((c, i) => ({
  primitive: "ray",
  definitionId: c.effectId,
  emitterId: c.emitterIndex,
  materialKey: `${c.effectId}:${c.emitterIndex}`,
  sourceEventId: "supplied-ray-ownership-control",
  generation: 1,
  ownerId: 3,
  particleCount: c.geometry.verticesHex.length / 2 / 112,
  vertexBytes: Uint8Array.fromHex(c.geometry.verticesHex),
  indices: new Uint16Array(Uint8Array.fromHex(c.geometry.indicesHex).buffer),
}));
renderer.commit({ time: 1, draws }, camera);
assert.equal(renderer.meshes.size, 2);
const before = [...renderer.meshes.values()],
  textures = before.map((m) => m.material.uniforms.TEXTURE_TX.value),
  blocks = before.map((m) => m.userData.blocks),
  packed = before[0].geometry.getAttribute("a_TEXCOORD").array.slice();
before.forEach((m) => m.onAfterRender());
assert.equal(submitted.length, 2);
assert.equal(before[0].material.blendSrc, THREE.SrcAlphaFactor);
assert.equal(before[0].material.blendDst, THREE.OneMinusSrcAlphaFactor);
assert.equal(before[1].material.blendDst, THREE.OneFactor);
assert.equal(before[0].material.side, THREE.DoubleSide);
assert.notEqual(blocks[0][0].group, blocks[1][0].group);
const basePixel = textures[0].image.data.slice();
camera.position.x += 10;
renderer.commit({ time: 1, draws }, camera);
assert.equal(
  [...renderer.meshes.values()][0].material.uniforms.TEXTURE_TX.value,
  textures[0],
);
assert.deepEqual(textures[0].image.data, basePixel);
assert.deepEqual(
  [...renderer.meshes.values()][0].geometry.getAttribute("a_TEXCOORD").array,
  packed,
);
assert.throws(
  () => renderer.commit({ time: 2, draws: [...draws, draws[0]] }, camera),
  /Duplicate/,
);
assert.equal(renderer.meshes.size, 2);
assert.throws(
  () =>
    renderer.commit({ time: 2, draws: [{ ...draws[0], ownerId: 5 }] }, camera),
  /owner changed/,
);
assert.equal(renderer.meshes.size, 2);
assert.throws(
  () =>
    renderer.commit(
      { time: 2, draws: [{ ...draws[0], materialKey: draws[1].materialKey }] },
      camera,
    ),
  /Unowned/,
);
assert.throws(
  () =>
    renderer.commit(
      { time: 2, draws: [{ ...draws[0], vertexBytes: new Uint8Array(1) }] },
      camera,
    ),
  /Malformed/,
);
renderer.commit(
  { time: 2, draws: [draws[0], { ...draws[0], generation: 2 }] },
  camera,
);
assert.equal(renderer.meshes.size, 2);
renderer.setEnabled(false);
[...renderer.meshes.values()].forEach((m) => m.onAfterRender());
assert.equal(submitted.length, 2);
renderer.setEnabled(true);
[...renderer.meshes.values()].forEach((m) => m.onAfterRender());
assert.equal(submitted.length, 4);
const parent = new THREE.Group();
parent.add(renderer.group);
renderer.dispose();
assert.equal(parent.children.length, 0);
assert.equal(renderer.meshes.size, 0);
assert.equal(renderer.ready, false);
for (const [p, h] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(p).bytes()),
    h,
    "Final renderer drift",
  );
await Bun.write(
  `${cache}/research/direct-ray-renderer-control.json`,
  JSON.stringify({
    schema: 1,
    kind: "real-three-ray-renderer-control",
    inputs,
    materialBindings: tokens.size,
    sourceGeometryCases: draws.length,
    ownershipControls: 6,
    cameraRedrawKeepsTextures: true,
    distinctGenerationsRetained: true,
    scope: {
      actualThreeExecuted: true,
      webGLExecuted: false,
      nativeMatchActivation: false,
    },
  }),
);
console.log(
  JSON.stringify({
    status: "pass",
    bindings: tokens.size,
    inputs: Object.keys(inputs).length,
  }),
);
