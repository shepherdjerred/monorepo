// Actual executor/main staging methods, with an explicit command/readiness host.
// This establishes rejection/transaction boundaries, not WebGL pixel evidence.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createThreeBufferSubmissionControl } from "./direct-three-buffer-submission.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  root = resolve(import.meta.dir, "..");
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    hash = await sha256(b);
  if (inputs[path] && inputs[path] !== hash) throw Error(`Drift:${path}`);
  inputs[path] = hash;
  return b;
}
const names = [
  "latest-direct-effect-renderer.mjs",
  "latest-direct-static-mesh-renderer.mjs",
  "latest-direct-nav-scene-renderer.mjs",
  "latest-direct-nav-scene.mjs",
  "latest-direct-nav-scene-gpu.mjs",
];
await captureDirectSourceInputs(
  [
    import.meta.path,
    ...names.map((n) => resolve(root, n)),
    resolve(root, "latest-viewer.mjs"),
  ],
  raw,
);
const build = await Bun.build({
  entrypoints: ["nav-staging-entry"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "owned-nav-staging",
      setup(b) {
        b.onResolve({ filter: /^nav-staging-entry$/ }, () => ({
          path: "entry",
          namespace: "nav-staging",
        }));
        b.onLoad({ filter: /.*/, namespace: "nav-staging" }, () => ({
          loader: "js",
          contents: names
            .map(
              (n) =>
                `export * from ${JSON.stringify(resolve(root, n).replaceAll("\\", "/"))};`,
            )
            .join("\n"),
        }));
        b.onResolve({ filter: /^three$/ }, () => ({
          path: resolve(cache, "public/vendor/three.module.js"),
        }));
      },
    },
  ],
});
if (!build.success)
  throw new AggregateError(build.logs, "Staging bundle failed");
const bundle = `${cache}/research/direct-nav-staging.bundle.mjs`;
await Bun.write(bundle, build.outputs[0]);
await raw(bundle);
const api = await import(pathToFileURL(bundle).href),
  THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  );
await raw(`${cache}/public/vendor/three.module.js`);
await raw(`${cache}/public/vendor/three.core.js`);
const threeSubmission = createThreeBufferSubmissionControl(
  new TextDecoder().decode(await raw(`${cache}/public/vendor/three.module.js`)),
);
const worldNavScene = await api.createLatestDirectNavScene({
  sceneManifestBytes: await raw(`${cache}/public/latest-scene/manifest.json`),
  sourcePackageBytes: await raw(
    `${cache}/public/latest-direct-nav-scene/package.json`,
  ),
  policy: "selected-installed-scene-initial-navigation-replay-zero-v1",
});
let draws = 0,
  failAt = 0,
  drawErrorAt = 0,
  pendingGlError = 0,
  link = true,
  currentTarget = null,
  viewport = new THREE.Vector4(0, 0, 1920, 1080);
const programs = new WeakMap(),
  gl = {
    SCISSOR_BOX: 0xc10,
    SCISSOR_TEST: 0xc11,
    NO_ERROR: 0,
    LINK_STATUS: 0x8b82,
    getError: () => {
      const e = pendingGlError;
      pendingGlError = 0;
      return e;
    },
    getParameter: () => [0, 0, 1920, 1080],
    isEnabled: () => false,
    getProgramParameter: () => link,
  };
const host = {
  isWebGLRenderer: true,
  xr: { enabled: false },
  autoClear: true,
  info: threeSubmission.info,
  properties: { get: (m) => programs.get(m) },
  compileAsync: async (scene) => {
    programs.set(scene.children[0].material, {
      currentProgram: { program: {} },
    });
  },
  getContext: () => gl,
  getRenderTarget: () => currentTarget,
  getActiveCubeFace: () => 0,
  getActiveMipmapLevel: () => 0,
  getCurrentViewport: (v) => v.copy(viewport),
  initTexture() {},
  initRenderTarget() {},
  setRenderTarget: (t) => {
    currentTarget = t;
    if (t) viewport.copy(t.viewport);
  },
  state: {
    viewport: (v) => viewport.copy(v),
    scissor() {},
    setScissorTest() {},
  },
  render(scene, camera) {
    draws++;
    if (failAt === draws) {
      if (host.info.autoReset) host.info.reset();
    } else threeSubmission.render(scene, camera);
    if (drawErrorAt === draws) pendingGlError = 0x502;
  },
};
const program = await api.loadDirectNavSceneGpuProgram({
  load: (path) => raw(`${cache}/public/${path}`),
});
let rejected = 0;
const reject = (fn, pattern) => {
  assert.throws(fn, pattern);
  rejected++;
};
const failed = new api.LatestDirectNavSceneRenderer({
  renderer: host,
  worldNavScene,
  program,
});
link = false;
await assert.rejects(() => failed.prepare(), /readiness\/link/);
rejected++;
assert.equal(failed.ready, false);
assert.equal(draws, 0);
failed.dispose();
link = true;
const provider = new api.LatestDirectNavSceneRenderer({
  renderer: host,
  worldNavScene,
  program,
});
reject(() => provider.renderAtSync(1), /Prepared/);
await provider.prepare();
assert.equal(draws, 0);
provider.geometry.setDrawRange(0, Infinity);
reject(() => provider.renderAtSync(0.25), /"submittedCalls":0/);
assert.equal(threeSubmission.draws.length, 0);
provider.geometry.setDrawRange(0, 3);
draws = 0;
failAt = 1;
drawErrorAt = 1;
reject(() => provider.renderAtSync(0.5), /"glErrorHex":"0x502"/);
assert.equal(pendingGlError, 0);
assert.equal(threeSubmission.draws.length, 0);
draws = 0;
drawErrorAt = 0;
failAt = 3;
reject(() => provider.renderAtSync(1), /GPU draw/);
assert.equal(draws, 3);
failAt = 0;
const forward = provider.renderAtSync(1);
assert.equal(draws, 8);
assert.equal(provider.renderAtSync(1), forward);
assert.equal(draws, 8);
const required = {
  blocks: [
    {
      requiredMembers: [
        {
          name: "NAV_GRID_XFORM",
          scalar: "float",
          size: 16,
          rows: 1,
          columns: 4,
        },
      ],
    },
  ],
  textures: [
    { name: "NAVMESH_MASK_TEXTURE_SharedTexture", dimension: "texture2d" },
  ],
};
provider.materialInputs({
  requiredScene: required,
  binding: forward,
  replayTime: 1,
});
failAt = draws + 4;
reject(() => provider.renderAtSync(0.25), /GPU draw/);
reject(
  () =>
    provider.materialInputs({
      requiredScene: required,
      binding: forward,
      replayTime: 1,
    }),
  /Current/,
);
failAt = 0;
const calls = [],
  world = new THREE.Group(),
  camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
camera.position.set(0, 1000, 1000);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
let rejectMesh = false;
const staticReceiver = {
  ready: true,
  group: new THREE.Group(),
  world,
  bindings: new Map([
    ["test:1", { program: { index: 1, materialKey: "test:1" } }],
  ]),
  definitions: new Map([
    ["test", { emitters: [{ index: 1, materialKey: "test:1" }] }],
  ]),
  ownership: new Map(),
  meshes: new Map(),
};
const child = {
  setEnabled() {},
  commit(packet, ownedCamera, { preflightOnly = false } = {}) {
    if (rejectMesh) {
      api.LatestDirectStaticMeshRenderer.prototype.commit.call(
        staticReceiver,
        packet,
        ownedCamera,
        { preflightOnly },
      );
    }
    if (!preflightOnly)
      calls.push({ name: "mesh", camera: ownedCamera.matrixWorld.toArray() });
  },
};
const draw = {
  primitive: "arbitrary-quad",
  definitionId: "test",
  emitterId: 0,
  materialKey: "test:0",
  sourceEventId: "event",
  generation: 1,
  particleCount: 1,
  positions: new Float32Array(12),
  colors: new Float32Array(16),
  uv: new Float32Array(8),
  particleUV: Uint16Array.of(0, 0, 0x3c00),
  indices: Uint16Array.of(0, 1, 2, 0, 2, 3),
};
const nav = {
  preflight: (packet) => ({
    time: packet.time,
    pending: packet.draws
      .filter((d) => d.emitterId === 0)
      .map((draw) => ({ draw })),
  }),
  commit(s, b) {
    calls.push({ name: "nav", time: s.time, binding: b });
  },
  commitEmpty() {
    calls.push({ name: "empty" });
  },
  group: new THREE.Group(),
};
const receiver = {
  ready: true,
  enabled: true,
  world,
  group: new THREE.Group(),
  compiled: new Map([
    [
      "test",
      {
        emitters: [
          {
            index: 0,
            primitive: "arbitrary-quad",
            materialKey: "test:0",
            navGroundProgram: {},
          },
          { index: 1, primitive: "static-mesh", materialKey: "test:1" },
        ],
      },
    ],
  ]),
  gpuMaterials: new Map(),
  directOwnership: new Map(),
  directMeshes: new Map(),
  cameraBlocks: new Set(),
  navGroundRenderer: nav,
  navigation: { provider, loaderOnly: false },
  staticMeshRenderer: child,
  rayRenderer: null,
};
const packet = (time) => ({
  time,
  draws: [structuredClone(draw)],
  metrics: { simulationMs: 1, geometryMs: 1 },
});
const bad = {
  primitive: "static-mesh",
  definitionId: "test",
  emitterId: 1,
  materialKey: "test:1",
  sourceEventId: "event",
  generation: 1,
  particleCount: 1,
  meshRecords: new Uint8Array(1),
};
api.LatestDirectEffectRenderer.prototype.commitDirect.call(
  receiver,
  packet(2),
  camera,
);
assert(receiver.pendingCombat);
rejectMesh = true;
const before = draws;
reject(
  () =>
    api.LatestDirectEffectRenderer.prototype.commitDirect.call(
      receiver,
      { ...packet(2), draws: [draw, bad] },
      camera,
    ),
  /malformed static mesh/,
);
assert.equal(draws, before);
assert.deepEqual(calls, []);
assert.equal(receiver.directOwnership.size, 0);
assert.equal(receiver.pendingCombat, null);
api.LatestDirectEffectRenderer.prototype.submitStagedDirect.call(receiver);
assert.equal(draws, before);
assert.deepEqual(calls, []);
rejectMesh = false;
api.LatestDirectEffectRenderer.prototype.commitDirect.call(
  receiver,
  packet(2),
  camera,
);
const metrics = receiver.frameMetrics,
  ownedCamera = camera.matrixWorld.toArray();
assert.deepEqual(calls, []);
assert.equal(receiver.directOwnership.size, 0);
camera.position.set(999, 1, 999);
camera.updateMatrixWorld(true);
api.LatestDirectEffectRenderer.prototype.submitStagedDirect.call(receiver);
assert.equal(receiver.frameMetrics, metrics);
assert(
  Number.isFinite(metrics.packetSnapshotCpuMs) &&
    metrics.packetSnapshotCpuMs >= 0,
);
assert(metrics.geometryUploadPreparationMs >= metrics.packetSnapshotCpuMs);
assert.equal(calls[0].time, 2);
assert.deepEqual(calls[1].camera, ownedCamera);
assert.equal(receiver.directOwnership.size, 1);
assert(
  Number.isFinite(metrics.navPrepassCpuMs) &&
    Number.isFinite(metrics.deferredCombatCommitMs),
);
const count = calls.length;
api.LatestDirectEffectRenderer.prototype.submitStagedDirect.call(receiver);
assert.equal(calls.length, count);
api.LatestDirectEffectRenderer.prototype.commitDirect.call(
  receiver,
  packet(0.125),
  camera,
);
failAt = draws + 2;
reject(
  () =>
    api.LatestDirectEffectRenderer.prototype.submitStagedDirect.call(receiver),
  /GPU draw/,
);
assert.equal(calls.length, count);
assert.equal(receiver.group.visible, false);
failAt = 0;
api.LatestDirectEffectRenderer.prototype.commitDirect.call(
  receiver,
  packet(0.125),
  camera,
);
api.LatestDirectEffectRenderer.prototype.submitStagedDirect.call(receiver);
assert.equal(receiver.group.visible, true);
const oldCombat = new THREE.Object3D();
receiver.group.add(oldCombat);
world.add(receiver.group);
let sceneVisible = false;
world.traverseVisible((o) => {
  if (o === oldCombat) sceneVisible = true;
});
assert.equal(sceneVisible, true);
rejectMesh = true;
const beforeRejectedRedraw = draws;
reject(
  () =>
    api.LatestDirectEffectRenderer.prototype.commitDirect.call(
      receiver,
      { ...packet(0.0625), draws: [draw, bad] },
      camera,
    ),
  /malformed static mesh/,
);
sceneVisible = false;
world.traverseVisible((o) => {
  if (o === oldCombat) sceneVisible = true;
});
assert.equal(sceneVisible, false);
assert.equal(receiver.pendingCombat, null);
api.LatestDirectEffectRenderer.prototype.submitStagedDirect.call(receiver);
assert.equal(draws, beforeRejectedRedraw);
rejectMesh = false;
api.LatestDirectEffectRenderer.prototype.commitDirect.call(
  receiver,
  packet(0.0625),
  camera,
);
api.LatestDirectEffectRenderer.prototype.submitStagedDirect.call(receiver);
assert.equal(receiver.group.visible, true);
const viewer = new TextDecoder().decode(
  await raw(resolve(root, "latest-viewer.mjs")),
);
assert.match(viewer, /directEffectRenderer\?\.submitStagedDirect\?\.\(\)/);
assert.match(viewer, /directEffectRenderer:\s*session\.renderer/);
host.info.autoReset = false;
const cumulativeCalls = host.info.render.calls;
provider.renderAtSync(0.03125);
assert.equal(host.info.render.calls - cumulativeCalls, 5);
assert.ok(
  threeSubmission.draws.every(
    (d) => d.mode === 4 && d.start === 0 && d.count === 3,
  ),
);
host.info.autoReset = true;
provider.dispose();
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/direct-nav-staging-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "navigation-executor-and-mixed-frame-staging-control",
      inputs,
      counts: { negativeControls: rejected, completedCommandDraws: draws },
      scope: {
        actualMainStagingAndSubmitMethods: true,
        actualStaticMeshSemanticPreflight: true,
        ownedCameraSnapshot: true,
        metricsObjectIdentityRetained: true,
        shaderReadinessFailureControl: true,
        partialPassFailureAndBackwardsSeek: true,
        diagnosticUsesExplicitRendererSourceChecked: true,
        rejectedStagingHidesOldScenePresentation: true,
        threeObjectsExecuted: true,
        installedThreeRenderBufferDirectAndInfoExecuted: true,
        defaultInfiniteRangeSuppressesActualSubmissionControl: true,
        originalThreeVertexDrawRangePreserved: true,
        unconditionalGLErrorAndBothInfoResetModes: true,
        readinessAndGPUCommandHostSupplied: true,
        webGLBackendExecuted: false,
        browserAcceptance: null,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, rejected, draws }));
