// Real worker -> common frame bridge -> real THREE geometry/material objects.
// This CLI flow does not claim a browser or THREE GPU submission was observed.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParentWorkerClient } from "../latest-parent-worker-client.mjs";
import { parentGeometryAttributes } from "../latest-parent-render-frame.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  nativeBytes = await raw(`${cache}/research/effect-root-frames-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proof = await read(`${cache}/research/effect-root-frames-wasm.json`);
if (
  proof.observationSha256 !== sha(nativeBytes) ||
  proof.mismatchCount ||
  !proof.scope.allPreparedRootsCompared
)
  throw Error("Root renderer lacks complete native/WASM evidence");
for (const [name, digest] of Object.entries(proof.sources))
  if (sha(await raw(`${root}/${name}`)) !== digest)
    throw Error(`Root frame source changed: ${name}`);
const build = await Bun.build({
  entrypoints: [`${root}/latest-parent-renderer.mjs`],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(b) {
        b.onResolve({ filter: /^three$/ }, () => ({
          path: `${assets}/vendor/three.module.js`,
        }));
      },
    },
  ],
});
if (!build.success || build.outputs.length !== 1)
  throw Error("Root renderer bundle failed");
const bundle = `${cache}/research/effect-root-renderer.bundle.mjs`;
await Bun.write(bundle, build.outputs[0]);
const { LatestParentVfxRenderer } = await import(pathToFileURL(bundle).href),
  THREE = await import(pathToFileURL(`${assets}/vendor/three.module.js`).href),
  manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  cachePackageBytes = await raw(
    `${assets}/latest-effect-root-frame-caches/package.json`,
  ),
  catalog = JSON.parse(new TextDecoder().decode(cachePackageBytes)),
  bulkPackageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkPackageBytes)),
  common = {
    profile: await read(`${assets}/decoder-16.21-macos/profile.json`),
    image: await raw(`${assets}/decoder-16.21-macos/image.bin`),
    spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
    abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
    mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
    runtimeBytes: await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
    bulkPackageBytes,
    bulkWasmBytes: await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
    cachePackageBytes,
  },
  ids = [
    "champions/ornn/0/e0792451",
    "champions/jinx/2/30f9e0b8",
    "champions/akshan/20/96537678",
    "champions/gangplank/14/dc110b57",
    "champions/maokai/3/91aaf44c",
    "champions/ornn/0/5dcd8300",
  ],
  world = new THREE.Group(),
  renderer = new LatestParentVfxRenderer(world, manifest, manifestBytes, {
    assetBase: "http://127.0.0.1:4180/assets/",
  }),
  counts = {
    roots: 0,
    committedFrames: 0,
    geometryComparisons: 0,
    erosionMeshes: 0,
    preparedTextures: 0,
  },
  cases = [];
const binary = (g) => ({
  ...g,
  vertices: Uint8Array.from(Buffer.from(g.verticesHex, "hex")),
  indices: Uint8Array.from(Buffer.from(g.indicesHex, "hex")),
  draw: Uint8Array.from(Buffer.from(g.drawHex, "hex")),
});
try {
  await renderer.load(ids);
  for (const id of ids) {
    const c = native.cases.find((v) => v.effectId === id),
      ref = catalog.caches.find((v) => v.effectId === id),
      client = new LatestParentWorkerClient({
        workerUrl: new URL("../latest-parent-worker.mjs", import.meta.url),
      });
    try {
      await client.initialize({
        assetBase: "http://127.0.0.1:4180/assets/",
        runtimeModuleUrl: pathToFileURL(
          `${assets}/vendor/unicorn_x86_candidate.mjs`,
        ).href,
        options: {
          ...common,
          cacheBytes: await raw(
            `${assets}/latest-effect-root-frame-caches/${ref.file}`,
          ),
        },
      });
      const { handle, ownership } = await client.createParent({
        seed: 9876n,
        clock: { ...c.clockInput, ticks: c.clockInput.ticks.map(BigInt) },
      });
      if (!isDeepStrictEqual(ownership, c.ownership))
        throw Error("Root worker returned different ownership");
      renderer.bindParent(id, id, ownership);
      const started = performance.now();
      for (const expected of c.frames.slice(0, 12)) {
        const result = await client.frame(
            [{ handle, time: expected.time, maxSubsteps: 20 }],
            native.camera,
          ),
          actual = result.parents[0].geometry,
          reference = expected.geometry.map(binary);
        for (let i = 0; i < actual.length; i++)
          for (const key of ["vertices", "indices", "draw"])
            if (!isDeepStrictEqual(actual[i][key], reference[i][key]))
              throw Error("Root worker geometry changed");
        const frame = renderer.stageFrame({
          time: expected.time,
          camera: native.camera,
          parents: [{ key: id, time: expected.time, geometry: actual }],
        });
        renderer.commitFrame(frame, [
          1 / 1000,
          0,
          0,
          0,
          0,
          0,
          -1 / 1000,
          0,
          0,
          0,
          0,
          0.5,
          0,
          0,
          0,
          1,
        ]);
        for (const g of reference) {
          if (!g.indices.length) continue;
          const mesh = renderer.parentMeshes.get(id).get(g.emitterIndex),
            attrs = parentGeometryAttributes(g),
            binding = renderer.gpuMaterials.get(`${id}:${g.emitterIndex}`);
          if (!mesh?.visible || mesh.material !== binding.material)
            throw Error("Root committed mesh/material missing");
          for (const [name, value] of Object.entries(attrs)) {
            const actual =
              name === "index"
                ? mesh.geometry.index.array
                : mesh.geometry.attributes[name].array;
            if (!isDeepStrictEqual(actual, value))
              throw Error(`Committed root attribute changed: ${name}`);
          }
          counts.geometryComparisons++;
        }
        counts.committedFrames++;
      }
      counts.erosionMeshes += [...renderer.parentMeshes.get(id)].filter(
        ([i]) =>
          renderer.gpuMaterials.get(`${id}:${i}`).prepared.erosionInput ===
          "native-quad-texcoord-w",
      ).length;
      renderer.unbindParent(id);
      counts.roots++;
      cases.push({
        effectId: id,
        frames: 12,
        elapsedMilliseconds: performance.now() - started,
      });
    } finally {
      client.close();
      await client.termination;
    }
  }
  for (const texture of renderer.textures.values()) {
    if (
      texture.isDataTexture !== true ||
      !(texture.image.data instanceof Uint8Array) ||
      texture.format !== THREE.RGBAFormat ||
      texture.type !== THREE.UnsignedByteType ||
      texture.flipY ||
      texture.generateMipmaps ||
      texture.colorSpace !== THREE.NoColorSpace
    )
      throw Error("Root material texture presentation differs");
    counts.preparedTextures++;
  }
} finally {
  renderer.dispose();
}
if (world.children.length || renderer.meshes.size || renderer.gpuMaterials.size)
  throw Error("Disposed root renderer retained owned resources");
const sources = {};
for (const name of [
  "latest-parent-renderer.mjs",
  "latest-parent-render-frame.mjs",
  "latest-parent-frames.mjs",
  "latest-world-effect-abi.mjs",
  "latest-world-descriptor-abi.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
  "tools/inspect-effect-root-renderer.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
for (const file of [
  bundle,
  `${assets}/latest-quad-erosion-gpu/package.json`,
  `${assets}/latest-effect-root-textures/package.json`,
])
  await raw(file);
const report = {
  schema: 1,
  kind: "requested-root-worker-three-renderer-comparison",
  observationSha256: sha(nativeBytes),
  inputs,
  sources,
  cases,
  counts,
  mismatchCount: 0,
  scope: {
    actualModuleWorkers: true,
    actualThreeMaterialsAndGeometry: true,
    browserExecuted: false,
    gpuSubmissionObserved: false,
    matchLifecycleMapping: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-root-renderer.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
