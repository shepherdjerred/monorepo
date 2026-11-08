import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  entry = resolve(import.meta.dir, "../latest-direct-effect-renderer.mjs");
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h) throw Error("Atomicity source drift");
  inputs[path] = h;
  return b;
}
await captureDirectSourceInputs([import.meta.path, entry], raw);
await raw(`${cache}/public/vendor/three.module.js`);
const build = await Bun.build({
  entrypoints: [entry],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(b) {
        b.onResolve({ filter: /^three$/ }, () => ({
          path: `${cache}/public/vendor/three.module.js`,
        }));
      },
    },
  ],
});
if (!build.success)
  throw new AggregateError(build.logs, "Atomicity bundle failed");
const bundle = `${cache}/research/direct-ray-atomicity.bundle.mjs`;
await Bun.write(bundle, build.outputs[0]);
await raw(bundle);
const { LatestDirectEffectRenderer } = await import(pathToFileURL(bundle).href),
  THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  calls = [],
  child = (name) => ({
    setEnabled() {
      calls.push(`${name}:toggle`);
    },
    commit() {
      calls.push(`${name}:commit`);
    },
  }),
  owner = {
    sourceEventId: "existing-owner",
    generation: 1,
    definitionId: "existing",
    ownerId: null,
    ownershipStatus: "unresolved",
  },
  receiver = {
    ready: true,
    enabled: true,
    group: new THREE.Group(),
    compiled: new Map([
      [
        "mixed",
        {
          emitters: [
            { index: 0, primitive: "static-mesh", materialKey: "mixed:0" },
            { index: 1, primitive: "ray", materialKey: "mixed:1" },
          ],
        },
      ],
    ]),
    gpuMaterials: new Map(),
    directOwnership: new Map([["existing-owner:1", owner]]),
    world: new THREE.Group(),
    staticMeshRenderer: child("mesh"),
    rayRenderer: child("ray"),
  },
  mesh = {
    primitive: "static-mesh",
    definitionId: "mixed",
    emitterId: 0,
    materialKey: "mixed:0",
    sourceEventId: "new-mixed",
    generation: 1,
    particleCount: 1,
    meshRecords: new Uint8Array(176),
    indices: new Uint16Array(),
  },
  ray = {
    primitive: "ray",
    definitionId: "mixed",
    emitterId: 1,
    materialKey: "mixed:1",
    sourceEventId: "new-mixed",
    generation: 1,
    particleCount: 1,
    vertexBytes: new Uint8Array(112),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  },
  camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
camera.position.set(0, 1000, 1000);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const malformed = [
  { ...ray, vertexBytes: new Uint8Array(1) },
  { ...ray, indices: new Uint16Array([0, 1, 4, 0, 2, 3]) },
  { ...ray, particleCount: 2 },
  { ...ray, vertexBytes: Uint8Array.from(ray.vertexBytes) },
];
new DataView(malformed[3].vertexBytes.buffer).setFloat32(0, NaN, true);
for (const bad of malformed) {
  assert.throws(
    () =>
      LatestDirectEffectRenderer.prototype.commitDirect.call(
        receiver,
        { time: 1, draws: [mesh, bad] },
        camera,
      ),
    /Malformed|Nonfinite/,
  );
  assert.deepEqual(calls, []);
  assert.equal(receiver.directOwnership.size, 1);
  assert.equal(receiver.directOwnership.get("existing-owner:1"), owner);
}
assert.throws(
  () =>
    LatestDirectEffectRenderer.prototype.commitDirect.call(
      receiver,
      { time: 1, draws: [mesh, ray, { ...ray }] },
      camera,
    ),
  /Duplicate/,
);
assert.deepEqual(calls, []);
assert.equal(receiver.directOwnership.size, 1);
for (const [p, h] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(p).bytes()),
    h,
    "Final atomicity input drift",
  );
await Bun.write(
  `${cache}/research/direct-ray-atomicity-control.json`,
  JSON.stringify({
    schema: 1,
    kind: "main-renderer-mixed-ray-rejection-atomicity",
    inputs,
    malformedPackedGeometryControls: 4,
    duplicateControls: 1,
    childMutations: 0,
    priorOwnershipRetained: true,
    scope: {
      actualMainCommitMethodExecuted: true,
      actualThreeExecuted: true,
      childCommitCountersSupplied: true,
      webGLExecuted: false,
    },
  }),
);
console.log(
  JSON.stringify({
    status: "pass",
    inputs: Object.keys(inputs).length,
    controls: 5,
  }),
);
