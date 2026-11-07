// Compare every prepared requested root through the shared browser CPU runtime.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLatestParentFrames } from "../latest-parent-frames.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import { createParentRenderFrames } from "../latest-parent-render-frame.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  directory = `${assets}/latest-effect-root-frame-caches`,
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
  cachePackageBytes = await raw(`${directory}/package.json`),
  catalog = JSON.parse(new TextDecoder().decode(cachePackageBytes)),
  profile = await read(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  spawnBytes = await raw(`${decoder}/vfx-spawn.json`),
  abiBytes = await raw(`${assets}/latest-parent-frame-runtime/package.json`),
  mathPackageBytes = await raw(`${assets}/latest-parent-math/package.json`),
  runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  bulkBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkBytes)),
  wasmBytes = await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createLatestBulkUnicorn(
    factory,
    runtimeBytes,
    bulkBytes,
    wasmBytes,
  ),
  bridge = await createParentRenderFrames({
    effectsManifestBytes: await raw(`${assets}/latest-effects/manifest.json`),
    quadPackageBytes: await raw(
      `${assets}/latest-complete-quad-gpu/package.json`,
    ),
    trailPackageBytes: await raw(`${assets}/latest-trail-particles/gpu.json`),
    erosionPackageBytes: await raw(
      `${assets}/latest-quad-erosion-gpu/package.json`,
    ),
  });
if (
  catalog.observationSha256 !== sha(nativeBytes) ||
  native.kind !== "requested-root-native-frame-observations" ||
  catalog.caches.length !== native.counts.returningRoots
)
  throw Error("Requested-root native evidence differs");
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(resolve(import.meta.dir, name))) !== digest)
    throw Error(`Requested-root native producer changed: ${name}`);
for (const [path, digest] of Object.entries(native.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error(`Requested-root native input changed: ${path}`);
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Requested-root original instructions changed");
const worldDigest = (runtime) => {
  const world = runtime.worldState(),
    h = new Bun.CryptoHasher("sha256");
  for (const [at, bytes] of world.memory) {
    const header = new Uint8Array(16),
      v = new DataView(header.buffer);
    v.setBigUint64(0, BigInt(at), true);
    v.setBigUint64(8, BigInt(bytes.length), true);
    h.update(header);
    h.update(bytes);
  }
  return h.update(JSON.stringify(world.host)).digest("hex");
};
const cases = [],
  counts = {
    roots: 0,
    forwardFrames: 0,
    restoredFrames: 0,
    geometryRecords: 0,
    renderFrames: 0,
    worldRestorations: 0,
  },
  began = performance.now();
for (const c of native.cases.filter((v) => v.status === "frames-returned")) {
  const ref = catalog.caches.find((v) => v.effectId === c.effectId),
    runtime = await createLatestParentFrames({
      uc,
      profile,
      image,
      spawnBytes,
      abiBytes,
      cachePackageBytes,
      cacheBytes: await raw(`${directory}/${ref.file}`),
      loadBytes: (name) => raw(`${directory}/${name}`),
      mathPackageBytes,
      loadMathBytes: (name) => raw(`${assets}/latest-parent-math/${name}`),
    });
  try {
    const handle = runtime.createParent({
      seed: 9876n,
      clock: {
        ...c.clockInput,
        ticks: c.clockInput.ticks.map(BigInt),
      },
    });
    if (
      !isDeepStrictEqual(runtime.ownership(handle), c.ownership) ||
      !isDeepStrictEqual(runtime.state(handle), c.initialState)
    )
      throw Error(`Requested-root initial state differs: ${c.effectId}`);
    bridge.bindParent(handle, c.effectId, runtime.ownership(handle));
    let checkpoint;
    const timings = [];
    const compare = (expected, restored) => {
      const start = performance.now(),
        actual = runtime.advance(handle, expected.time, 20);
      actual.geometry = runtime.render(handle, native.camera);
      const reference = Object.fromEntries(
        ["time", "substeps", "state", "geometry"].map((key) => [
          key,
          expected[key],
        ]),
      );
      if (!isDeepStrictEqual(actual, reference)) {
        return Bun.write(
          `${cache}/research/effect-root-frame-difference.json`,
          JSON.stringify(
            {
              effectId: c.effectId,
              tick: expected.tick,
              restored,
              actual,
              expected: reference,
            },
            null,
            2,
          ),
        ).then(() => {
          throw Error(
            `Requested-root native/WASM difference: ${c.effectId} tick ${expected.tick}`,
          );
        });
      }
      const geometry = runtime.render(handle, native.camera, { binary: true });
      // The real bridge admits every actor/material, including the erosion
      // extension; no emitter is dropped to obtain a renderable root.
      const frame = bridge.stage({
        time: expected.time,
        camera: native.camera,
        parents: [{ key: handle, time: expected.time, geometry }],
      });
      if (frame.draws.length !== geometry.length)
        throw Error("Requested-root material bridge omitted actors");
      counts.geometryRecords += geometry.length;
      counts.renderFrames++;
      counts[restored ? "restoredFrames" : "forwardFrames"]++;
      timings.push(performance.now() - start);
    };
    for (const frame of c.frames) {
      await compare(frame, false);
      if (frame.tick === 12) checkpoint = runtime.checkpoint();
    }
    const final = worldDigest(runtime);
    runtime.restore(checkpoint);
    for (const frame of c.frames.slice(12)) await compare(frame, true);
    if (worldDigest(runtime) !== final)
      throw Error("Requested-root WASM restored CPU world differs");
    counts.worldRestorations++;
    runtime.releaseCheckpoint(checkpoint);
    bridge.unbindParent(handle);
    counts.roots++;
    cases.push({
      effectId: c.effectId,
      frames: c.frames.length,
      finalCpuWorldSha256: final,
      milliseconds: timings,
    });
    console.log(
      JSON.stringify({
        effectId: c.effectId,
        completed: counts.roots,
        total: catalog.caches.length,
        elapsedSeconds: (performance.now() - began) / 1000,
      }),
    );
  } finally {
    runtime.close();
  }
}
const sources = {};
for (const name of [
  "latest-parent-frames.mjs",
  "latest-parent-math.mjs",
  "latest-parent-placement.mjs",
  "latest-parent-render-frame.mjs",
  "tools/inspect-effect-root-frames.mjs",
])
  sources[name] = sha(await raw(resolve(import.meta.dir, "..", name)));
const report = {
  schema: 1,
  kind: "requested-root-native-wasm-frame-comparison",
  observationSha256: sha(nativeBytes),
  cachePackageSha256: sha(cachePackageBytes),
  inputs,
  sources,
  cases,
  counts,
  mismatchCount: 0,
  scope: {
    allPreparedRootsCompared: counts.roots === catalog.caches.length,
    completeParentStateAndGeometry: true,
    materialBridgeExecuted: true,
    wholeWorldRestoreCompared: true,
    browserExecuted: false,
    matchLifecycleMapping: false,
    gpuSubmissionObserved: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-root-frames-wasm.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
