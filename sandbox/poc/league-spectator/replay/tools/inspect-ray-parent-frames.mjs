// Compare the shared browser CPU runtime to complete original ray-parent frames.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  createLatestParentFrames,
  PARENT_RAY_CACHES_SHA,
} from "../latest-parent-frames.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import { parentGeometryAttributes } from "../latest-parent-render-frame.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  directory = `${assets}/latest-ray-parent-caches`,
  decoder = `${assets}/decoder-16.21-macos`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  nativeBytes = await raw(`${cache}/research/ray-parent-frames-native.json`),
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
  );
if (
  native.kind !== "native-ray-parent-frame-observations" ||
  native.scope.partialSelection ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  catalog.kind !== "prepared-ray-parent-resource-caches" ||
  catalog.observationSha256 !== sha(nativeBytes) ||
  sha(cachePackageBytes) !== PARENT_RAY_CACHES_SHA ||
  catalog.caches.length !== native.counts.returningRoots ||
  native.counts.roots !== native.counts.returningRoots
)
  throw Error(
    "Complete original ray-parent cohort and exact cache package required",
  );
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`Ray native producer changed: ${name}`);
for (const [path, digest] of Object.entries(native.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error(`Ray native input changed: ${path}`);
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Ray original code changed");
function worldDigest(runtime) {
  const world = runtime.worldState(),
    hash = new Bun.CryptoHasher("sha256");
  for (const [address, bytes] of world.memory) {
    const header = new Uint8Array(16),
      view = new DataView(header.buffer);
    view.setBigUint64(0, BigInt(address), true);
    view.setBigUint64(8, BigInt(bytes.length), true);
    hash.update(header);
    hash.update(bytes);
  }
  return hash.update(JSON.stringify(world.host)).digest("hex");
}
const counts = {
    roots: 0,
    forwardFrames: 0,
    restoredFrames: 0,
    geometryRecords: 0,
    geometryAttributeRecords: 0,
    worldRestorations: 0,
    nonemptyRayRecords: 0,
    nonemptyArbitraryTrailRecords: 0,
  },
  cases = [],
  began = performance.now();
for (const c of native.cases) {
  const ref = catalog.caches.find((ref) => ref.effectId === c.effectId),
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
      clock: { ...c.clockInput, ticks: c.clockInput.ticks.map(BigInt) },
    });
    if (
      !isDeepStrictEqual(runtime.ownership(handle), c.ownership) ||
      !isDeepStrictEqual(runtime.state(handle), c.initialState)
    )
      throw Error(`Initial native/WASM ray parent differs: ${c.effectId}`);
    const timings = [];
    async function compare(frame, restored) {
      const start = performance.now(),
        actual = runtime.advance(handle, frame.time, 20);
      actual.geometry = runtime.render(handle, native.camera);
      const expected = Object.fromEntries(
        ["time", "substeps", "state", "geometry"].map((key) => [
          key,
          frame[key],
        ]),
      );
      if (!isDeepStrictEqual(actual, expected)) {
        await Bun.write(
          `${cache}/research/ray-parent-frame-difference.json`,
          JSON.stringify(
            {
              effectId: c.effectId,
              tick: frame.tick,
              restored,
              actual,
              expected,
            },
            null,
            2,
          ),
        );
        throw Error(
          `Ray native/WASM frame differs: ${c.effectId} tick ${frame.tick}`,
        );
      }
      const binary = runtime.render(handle, native.camera, { binary: true });
      if (binary.length !== actual.geometry.length)
        throw Error("Ray binary geometry omitted an actor");
      for (let i = 0; i < binary.length; i++)
        for (const [field, source] of [
          ["vertices", "verticesHex"],
          ["indices", "indicesHex"],
          ["draw", "drawHex"],
        ])
          if (
            Buffer.from(binary[i][field]).toString("hex") !==
            actual.geometry[i][source]
          )
            throw Error("Ray binary geometry differs");
      for (const geometry of binary) {
        const attributes = parentGeometryAttributes(geometry);
        if (
          attributes.a_POSITION.length !==
            (geometry.vertices.length / 28) * 3 ||
          attributes.index.length !== geometry.indices.length / 2
        )
          throw Error("Ray render attributes omitted geometry");
        counts.geometryAttributeRecords++;
      }
      counts.geometryRecords += actual.geometry.length;
      counts[restored ? "restoredFrames" : "forwardFrames"]++;
      for (const g of actual.geometry)
        if (g.verticesHex) {
          if (g.kind === "ray") counts.nonemptyRayRecords++;
          if (g.kind === "arbitrary-trail")
            counts.nonemptyArbitraryTrailRecords++;
        }
      timings.push(performance.now() - start);
    }
    let checkpoint;
    const middle = Math.floor(c.frames.length / 2);
    for (const frame of c.frames) {
      await compare(frame, false);
      if (frame.tick === middle) checkpoint = runtime.checkpoint();
    }
    const final = worldDigest(runtime);
    runtime.restore(checkpoint);
    for (const frame of c.frames.slice(middle)) await compare(frame, true);
    if (worldDigest(runtime) !== final)
      throw Error("Ray restored WASM CPU world differs");
    runtime.releaseCheckpoint(checkpoint);
    counts.worldRestorations++;
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
        total: native.cases.length,
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
  "latest-unicorn-bulk.mjs",
  "tools/inspect-ray-parent-frames.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-ray-parent-frame-comparison",
  build: native.build,
  protocol: native.protocol,
  observationSha256: sha(nativeBytes),
  cachePackageSha256: sha(cachePackageBytes),
  inputs,
  sources,
  cases,
  counts,
  mismatchCount: 0,
  scope: {
    allPreparedRootsCompared: counts.roots === native.counts.roots,
    completeParentStateAndGeometry: true,
    wholeWorldRestoreCompared: true,
    binaryGeometryCompared: true,
    renderAttributeParserExecuted: true,
    materialBridgeExecuted: false,
    gpuSubmissionObserved: false,
    matchCreationImplemented: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/ray-parent-frames-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
