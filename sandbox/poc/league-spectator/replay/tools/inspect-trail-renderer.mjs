// Inspect the actual THREE attribute adapter, resize lifecycle and browser build.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [arg, option] = process.argv.slice(2);
if (!arg || process.argv.length > 4 || (option && option !== "--quad-pools"))
  throw Error("Usage: inspect-trail-renderer.mjs <cache> [--quad-pools]");
const mode = option ? "quad-pool" : "trail";
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {},
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const bundle = await Bun.build({
  entrypoints: [`${root}/latest-${mode}-renderer.mjs`],
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
  throw Error("Trail renderer bundle failed");
const bundlePath = `${cache}/research/${mode}-renderer.bundle.mjs`;
await Bun.write(bundlePath, bundle.outputs[0]);
const module = await import(pathToFileURL(bundlePath).href),
  THREE = await import(pathToFileURL(`${assets}/vendor/three.module.js`).href),
  playback = await read(`${cache}/research/${mode}-playback.json`),
  native = await read(`${cache}/research/${mode}-playback-native.json`),
  Renderer = option
    ? module.LatestQuadPoolVfxRenderer
    : module.LatestTrailVfxRenderer,
  renderer = new Renderer(new THREE.Group(), {}, new Uint8Array()),
  mesh = { geometry: new THREE.BufferGeometry() },
  counts = { frames: 0, attributeBytes: 0, resizes: 0, rejectionChecks: 0 };
const replayTrailAttributes = (geometry) => renderer.decodeGeometry(geometry);
if (
  native.playbackSha256 !== inputs[`${cache}/research/${mode}-playback.json`] ||
  native.mismatches
)
  throw Error("Trail native playback proof differs");
const samples = playback.observations.filter((s) => s.actual);
for (const s of [...samples, ...samples.toReversed()]) {
  const geometry = s.actual.geometry,
    a = replayTrailAttributes(geometry),
    before = mesh.geometry;
  renderer.applyGeometry(mesh, geometry);
  if (before !== mesh.geometry) counts.resizes++;
  const n = a.a_POSITION.length / 3,
    rebuilt = new Uint8Array(n * 28),
    view = new DataView(rebuilt.buffer);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++)
      view.setFloat32(
        i * 28 + j * 4,
        mesh.geometry.attributes.a_POSITION.array[i * 3 + j],
        true,
      );
    rebuilt.set(
      mesh.geometry.attributes.a_COLOR.array.subarray(i * 4, i * 4 + 4),
      i * 28 + 12,
    );
    for (let j = 0; j < 4; j++)
      view.setUint16(
        i * 28 + 16 + j * 2,
        mesh.geometry.attributes.a_TEXCOORD.array[i * 4 + j],
        true,
      );
    for (let j = 0; j < 2; j++)
      view.setUint16(
        i * 28 + 24 + j * 2,
        mesh.geometry.attributes.a_TEXCOORD1.array[i * 2 + j],
        true,
      );
  }
  if (
    Buffer.from(rebuilt).toString("hex") !== geometry.verticesHex ||
    Buffer.from(mesh.geometry.index.array.buffer).toString("hex") !==
      geometry.indicesHex ||
    !mesh.geometry.attributes.a_COLOR.normalized ||
    !mesh.geometry.attributes.a_TEXCOORD.isFloat16BufferAttribute
  )
    throw Error("Trail THREE adapter changed native bits");
  counts.frames++;
  counts.attributeBytes +=
    rebuilt.length + mesh.geometry.index.array.byteLength;
}
for (const bad of [
  { verticesHex: "00", indicesHex: "" },
  { verticesHex: "", indicesHex: "0000" },
  { verticesHex: "zz", indicesHex: "" },
]) {
  let rejected = false;
  try {
    replayTrailAttributes(bad);
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Malformed trail geometry accepted");
  counts.rejectionChecks++;
}
mesh.geometry.dispose();
renderer.dispose();
const browser = await Bun.build({
  entrypoints: [`${root}/latest-viewer.mjs`],
  target: "browser",
  write: false,
  external: ["three", "three/*", "/assets/*"],
});
if (!browser.success)
  throw new AggregateError(browser.logs, "Replay viewer browser build failed");
const sources = {};
for (const name of [
  "latest-trail-renderer.mjs",
  "latest-quad-pool-renderer.mjs",
  "latest-quad-pool-playback.mjs",
  "latest-trail-playback.mjs",
  "latest-particle-playback.mjs",
  "latest-unicorn-bulk.mjs",
  "latest-effect-pipeline.mjs",
  "latest.html",
  "latest-trail-particles.mjs",
  "latest-vfx-bound-renderer.mjs",
  "latest-viewer.mjs",
  "tools/inspect-trail-renderer.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
for (const path of [
  bundlePath,
  `${assets}/vendor/three.module.js`,
  `${assets}/vendor/three.core.js`,
])
  await raw(path);
await Bun.write(
  `${cache}/research/${mode}-renderer-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: `${mode}-renderer-input-comparison`,
      sources,
      inputs,
      counts,
      scope: {
        actualThreeAttributeAdapter: true,
        nativePackedBitsUnchanged: true,
        browserBundleBuilt: true,
        mainViewerSourceIntegrated: true,
        threeGpuSubmissionObserved: false,
        browserRun: false,
        referenceCompared: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
