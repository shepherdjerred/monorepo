// Actual THREE attribute adapter over the independently compared replay corpus.
// GPU submission and browser bitmap loading are deliberately outside this proof.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createParentRenderFrames } from "../latest-parent-render-frame.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const nativeBytes = await raw(`${cache}/research/parent-missiles-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proof = await read(`${cache}/research/parent-missiles-wasm.json`);
if (
  proof.observationSha256 !== sha(nativeBytes) ||
  proof.mismatchCount ||
  proof.counts.parents !== 30 ||
  proof.counts.geometryRecords !== 10230
)
  throw Error("Incomplete renderer native/WASM replay reference");
for (const [name, digest] of Object.entries(proof.sources))
  if (sha(await raw(`${root}/${name}`)) !== digest)
    throw Error(`Compared parent source changed: ${name}`);
const bridge = await createParentRenderFrames({
  effectsManifestBytes: await raw(`${assets}/latest-effects/manifest.json`),
  quadPackageBytes: await raw(
    `${assets}/latest-complete-quad-gpu/package.json`,
  ),
  trailPackageBytes: await raw(`${assets}/latest-trail-particles/gpu.json`),
});
const bundle = await Bun.build({
  entrypoints: [`${root}/latest-parent-renderer.mjs`],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(build) {
        build.onResolve({ filter: /^three$/ }, () => ({
          path: `${assets}/vendor/three.module.js`,
        }));
      },
    },
  ],
});
if (!bundle.success || bundle.outputs.length !== 1)
  throw Error("Parent renderer CLI bundle failed");
const bundlePath = `${cache}/research/parent-renderer.bundle.mjs`;
await Bun.write(bundlePath, bundle.outputs[0]);
const { LatestParentVfxRenderer } = await import(
    pathToFileURL(bundlePath).href
  ),
  THREE = await import(pathToFileURL(`${assets}/vendor/three.module.js`).href);
const renderer = new LatestParentVfxRenderer(
    new THREE.Group(),
    {},
    new Uint8Array(),
  ),
  meshes = new Map();
const fromHex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const geometry = (g) => {
  const { verticesHex, indicesHex, drawHex, ...rest } = g;
  return {
    ...rest,
    vertices: fromHex(verticesHex),
    indices: fromHex(indicesHex),
    draw: fromHex(drawHex),
  };
};
const counts = {
    worldFrames: 0,
    parentFrames: 0,
    drawRecords: 0,
    attributeBytes: 0,
    resizes: 0,
    rejections: 0,
    offsetBufferChecks: 0,
  },
  checks = [];
let lastStage, lastInput;
function reject(fn) {
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Malformed or unowned render frame was accepted");
  counts.rejections++;
}
function rebuild(g) {
  const n = g.attributes.a_POSITION.array.length / 3,
    vertices = new Uint8Array(n * 28),
    view = new DataView(vertices.buffer),
    indices = new Uint8Array(g.index.array.length * 2),
    iv = new DataView(indices.buffer);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++)
      view.setFloat32(
        i * 28 + j * 4,
        g.attributes.a_POSITION.array[i * 3 + j],
        true,
      );
    vertices.set(
      g.attributes.a_COLOR.array.subarray(i * 4, i * 4 + 4),
      i * 28 + 12,
    );
    for (let j = 0; j < 4; j++)
      view.setUint16(
        i * 28 + 16 + j * 2,
        g.attributes.a_TEXCOORD.array[i * 4 + j],
        true,
      );
    for (let j = 0; j < 2; j++)
      view.setUint16(
        i * 28 + 24 + j * 2,
        g.attributes.a_TEXCOORD1.array[i * 2 + j],
        true,
      );
  }
  for (let i = 0; i < g.index.array.length; i++)
    iv.setUint16(i * 2, g.index.array[i], true);
  return { vertices, indices };
}
try {
  for (let bi = 0; bi < native.cases.length; bi++) {
    const c = native.cases[bi];
    bridge.clear();
    for (const p of c.parents)
      bridge.bindParent(p.sequence, c.effectId, p.ownership);
    for (const f of [...c.frames, ...c.frames.slice(6).toReversed()]) {
      const packet = {
        time: f.time,
        camera: native.camera,
        parents: f.parents.map((p) => ({
          key: p.sequence,
          time: p.time,
          geometry: p.geometry.map(geometry),
        })),
      };
      const stage = bridge.stage(packet);
      bridge.assertCurrent(stage);
      for (const draw of stage.draws) {
        const key = `${bi}:${draw.key}:${draw.emitterIndex}`;
        if (!meshes.has(key))
          meshes.set(key, { geometry: new THREE.BufferGeometry() });
        const mesh = meshes.get(key),
          before = mesh.geometry;
        renderer.applyGeometry(mesh, draw);
        if (before !== mesh.geometry) counts.resizes++;
        const rebuilt = rebuild(mesh.geometry),
          source = packet.parents
            .find((p) => p.key === draw.key)
            .geometry.find((g) => g.emitterIndex === draw.emitterIndex);
        if (
          sha(rebuilt.vertices) !== sha(source.vertices) ||
          sha(rebuilt.indices) !== sha(source.indices) ||
          !mesh.geometry.attributes.a_COLOR.normalized ||
          !mesh.geometry.attributes.a_TEXCOORD.isFloat16BufferAttribute ||
          !mesh.geometry.attributes.a_TEXCOORD1.isFloat16BufferAttribute
        )
          throw Error(
            "Parent THREE adapter changed native attribute bits or types",
          );
        counts.drawRecords++;
        counts.attributeBytes +=
          rebuilt.vertices.length + rebuilt.indices.length;
      }
      counts.worldFrames++;
      counts.parentFrames += packet.parents.length;
      checks.push({ burst: bi, time: f.time, draws: stage.draws.length });
      lastStage = stage;
      lastInput = packet;
    }
  }
  reject(() => bridge.assertCurrent({ ...lastStage }));
  reject(() =>
    bridge.stage({ ...lastInput, parents: lastInput.parents.slice(1) }),
  );
  reject(() =>
    bridge.stage({
      ...lastInput,
      parents: lastInput.parents.map((p, i) =>
        i === 0 ? { ...p, time: p.time + 1 } : p,
      ),
    }),
  );
  reject(() =>
    bridge.stage({
      ...lastInput,
      parents: lastInput.parents.map((p, i) =>
        i === 0 ? { ...p, geometry: p.geometry.slice(1) } : p,
      ),
    }),
  );
  const badActor = structuredClone(lastInput);
  badActor.parents[0].geometry[0].actor++;
  reject(() => bridge.stage(badActor));
  const badCount = structuredClone(lastInput);
  badCount.parents[0].geometry[0].particleCount = 1025;
  reject(() => bridge.stage(badCount));
  const badPosition = structuredClone(lastInput),
    withVertices = badPosition.parents
      .flatMap((p) => p.geometry)
      .find((g) => g.vertices.length);
  new DataView(withVertices.vertices.buffer).setFloat32(0, NaN, true);
  reject(() => bridge.stage(badPosition));
  const badIndex = structuredClone(lastInput),
    withIndices = badIndex.parents
      .flatMap((p) => p.geometry)
      .find((g) => g.indices.length);
  new DataView(withIndices.indices.buffer).setUint16(0, 65535, true);
  reject(() => bridge.stage(badIndex));
  bridge.assertCurrent(lastStage);
  const hidden = bridge.stage({
    ...lastInput,
    parents: lastInput.parents.map(({ geometry, ...p }) => ({
      ...p,
      visible: false,
    })),
  });
  if (hidden.draws.length) throw Error("Hidden parent retained stale draws");
  counts.hiddenFrames = (counts.hiddenFrames ?? 0) + 1;
  reject(() =>
    bridge.stage({
      ...lastInput,
      parents: lastInput.parents.map((p) => ({ ...p, visible: false })),
    }),
  );
  const offset = structuredClone(lastInput);
  for (const p of offset.parents)
    for (const g of p.geometry)
      for (const field of ["vertices", "indices", "draw"]) {
        const padded = new Uint8Array(g[field].length + 32);
        padded.set(g[field], 16);
        g[field] = padded.subarray(16, 16 + g[field].length);
      }
  const offsetStage = bridge.stage(offset);
  for (let i = 0; i < offsetStage.draws.length; i++) {
    const a = offsetStage.draws[i].attributes,
      b = lastStage.draws[i].attributes;
    for (const field of Object.keys(a))
      if (
        sha(new Uint8Array(a[field].buffer)) !==
        sha(new Uint8Array(b[field].buffer))
      )
        throw Error("Parent buffer byteOffset changed attributes");
    counts.offsetBufferChecks++;
  }
  bridge.unbindParent(lastInput.parents[0].key);
  reject(() => bridge.assertCurrent(lastStage));
} finally {
  for (const mesh of meshes.values()) mesh.geometry.dispose();
  renderer.dispose();
}
const browser = await Bun.build({
  entrypoints: [`${root}/latest-parent-renderer.mjs`],
  target: "browser",
  write: false,
  external: ["three", "/assets/*"],
});
if (!browser.success || browser.outputs.length !== 1)
  throw Error("Parent renderer browser bundle failed");
const sources = {};
for (const name of [
  "latest-parent-render-frame.mjs",
  "latest-parent-renderer.mjs",
  "latest-trail-renderer.mjs",
  "latest-vfx-bound-renderer.mjs",
  "latest-vfx-renderer.mjs",
  "tools/inspect-parent-renderer.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
for (const p of [
  bundlePath,
  `${assets}/vendor/three.module.js`,
  `${assets}/vendor/three.core.js`,
])
  await raw(p);
const result = {
  schema: 1,
  kind: "complete-parent-renderer-attribute-comparison",
  nativeObservationSha256: sha(nativeBytes),
  workerProofSha256: inputs[`${cache}/research/parent-missiles-wasm.json`],
  inputs,
  sources,
  counts,
  checks,
  mismatchCount: 0,
  scope: {
    actualThreeAttributeAdapter: true,
    checkedMaterialAndActorBindings: true,
    nativeAttributeBitsUnchanged: true,
    geometryResizeLifecycle: true,
    browserBundleBuilt: true,
    browserBitmapLoadingExercised: false,
    threeGpuSubmissionObserved: false,
    browserExecuted: false,
    mainViewerIntegrated: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-renderer-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
