// Real module workers use static HTTP caches; compare their complete native
// output and checkpoint continuations. No browser or League process is launched.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParentWorkerClient } from "../latest-parent-worker-client.mjs";
import { PARENT_RAY_CACHES_SHA } from "../latest-parent-frames.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  directory = `${assets}/latest-ray-parent-caches`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  nativePath = `${cache}/research/ray-parent-frames-native.json`,
  native = await read(nativePath),
  proofPath = `${cache}/research/ray-parent-frames-comparison.json`,
  proof = await read(proofPath),
  bulkPackageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkPackageBytes)),
  common = {
    profile: await read(`${assets}/decoder-16.21-macos/profile.json`),
    image: await raw(`${assets}/decoder-16.21-macos/image.bin`),
    spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
    abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
    cachePackageBytes: await raw(`${directory}/package.json`),
    mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
    runtimeBytes: await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
    bulkPackageBytes,
    bulkWasmBytes: await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  },
  catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes)),
  check = (v, m) => {
    if (!v) throw Error(m);
  };
check(
  proof.kind === "native-wasm-ray-parent-frame-comparison" &&
    proof.mismatchCount === 0 &&
    proof.observationSha256 === inputs[nativePath] &&
    catalog.observationSha256 === inputs[nativePath] &&
    proof.cachePackageSha256 === PARENT_RAY_CACHES_SHA &&
    sha(common.cachePackageBytes) === PARENT_RAY_CACHES_SHA &&
    proof.scope.allPreparedRootsCompared,
  "Complete ray native/WASM comparison required",
);
for (const [name, digest] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === digest,
    `Ray CPU producer changed: ${name}`,
  );
const geometry = (list) =>
  list.map(({ vertices, indices, draw, ...g }) => ({
    ...g,
    verticesHex: Buffer.from(vertices).toString("hex"),
    indicesHex: Buffer.from(indices).toString("hex"),
    drawHex: Buffer.from(draw).toString("hex"),
  }));
const worldDigest = (world) => {
  const hash = new Bun.CryptoHasher("sha256");
  for (const [address, bytes] of world.memory) {
    const header = new Uint8Array(16),
      view = new DataView(header.buffer);
    view.setBigUint64(0, BigInt(address), true);
    view.setBigUint64(8, BigInt(bytes.length), true);
    hash.update(header);
    hash.update(bytes);
  }
  return hash.update(JSON.stringify(world.host)).digest("hex");
};
const counts = {
    roots: 0,
    forwardFrames: 0,
    restoredFrames: 0,
    geometryRecords: 0,
    worldRestorations: 0,
    transferredImages: 0,
    exportIsolationChecks: 0,
  },
  cases = [],
  began = performance.now();
for (const c of native.cases) {
  const client = new LatestParentWorkerClient();
  try {
    const ref = catalog.caches.find((r) => r.effectId === c.effectId),
      image = common.image.slice();
    await client.initialize({
      assetBase: "http://127.0.0.1:4180/assets/",
      runtimeModuleUrl: pathToFileURL(
        `${assets}/vendor/unicorn_x86_candidate.mjs`,
      ).href,
      options: {
        ...common,
        image,
        cacheBytes: await raw(`${directory}/${ref.file}`),
      },
      transferImage: true,
    });
    check(
      image.byteLength === 0,
      "Ray worker image was copied rather than transferred",
    );
    counts.transferredImages++;
    const { handle, ownership } = await client.createParent({
      seed: 9876n,
      clock: { ...c.clockInput, ticks: c.clockInput.ticks.map(BigInt) },
    });
    check(
      isDeepStrictEqual(ownership, c.ownership) &&
        isDeepStrictEqual((await client.inspect(handle)).state, c.initialState),
      "Ray worker factory differs from original native input",
    );
    let isolated = false;
    async function compare(f, restored) {
      const result = await client.frame(
        [{ handle, time: f.time, maxSubsteps: 20 }],
        native.camera,
        { captureState: true },
      );
      check(
        isDeepStrictEqual(result.camera, native.camera) &&
          result.parents.length === 1,
        "Ray worker frame envelope differs",
      );
      const { id, ...actual } = result.parents[0];
      actual.geometry = geometry(actual.geometry);
      const expected = Object.fromEntries(
        ["time", "substeps", "state", "geometry"].map((k) => [k, f[k]]),
      );
      check(
        isDeepStrictEqual(actual, expected),
        `Ray worker/native frame differs: ${c.effectId} ${f.tick}`,
      );
      counts[restored ? "restoredFrames" : "forwardFrames"]++;
      counts.geometryRecords += actual.geometry.length;
      if (!isolated) {
        const exported = result.parents[0].geometry.find(
          (g) => g.vertices.length,
        );
        if (exported) {
          exported.vertices.fill(255);
          exported.indices.fill(255);
          exported.draw.fill(255);
          check(
            isDeepStrictEqual(
              geometry((await client.render(handle, native.camera)).geometry),
              f.geometry,
            ),
            "Ray worker output aliases its native CPU memory",
          );
          isolated = true;
          counts.exportIsolationChecks++;
        }
      }
    }
    let checkpoint;
    const middle = Math.floor(c.frames.length / 2);
    for (const frame of c.frames) {
      await compare(frame, false);
      if (frame.tick === middle) checkpoint = await client.checkpoint();
    }
    check(
      isolated,
      "Ray worker produced no live geometry for export isolation comparison",
    );
    const final = worldDigest(await client.worldState());
    await client.restore(checkpoint);
    for (const frame of c.frames.slice(middle)) await compare(frame, true);
    check(
      worldDigest(await client.worldState()) === final,
      "Ray worker restored CPU world differs",
    );
    await client.releaseCheckpoint(checkpoint);
    counts.worldRestorations++;
    counts.roots++;
    cases.push({
      effectId: c.effectId,
      frames: c.frames.length,
      finalCpuWorldSha256: final,
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
    try {
      if (!client.closed) await client.request("dispose", null);
    } finally {
      client.close();
      await client.termination;
    }
  }
}
const sources = {};
for (const name of [
  "latest-parent-frames.mjs",
  "latest-parent-render-frame.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
  "latest-particle-worker-client.mjs",
  "tools/inspect-ray-parent-workers.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const browserBuild = await Bun.build({
  entrypoints: [
    `${root}/latest-parent-worker.mjs`,
    `${root}/latest-parent-worker-client.mjs`,
  ],
  target: "browser",
  write: false,
});
check(
  browserBuild.success && browserBuild.outputs.length === 2,
  "Ray worker/client browser bundle failed",
);
const bundles = [];
for (const output of browserBuild.outputs) {
  const bytes = new Uint8Array(await output.arrayBuffer());
  bundles.push({ file: output.path, bytes: bytes.length, sha256: sha(bytes) });
}
const result = {
  schema: 1,
  kind: "ray-parent-worker-native-comparison",
  observationSha256: inputs[nativePath],
  comparisonSha256: inputs[proofPath],
  inputs,
  sources,
  bundles,
  cases,
  counts,
  mismatchCount: 0,
  scope: {
    realModuleWorkers: true,
    staticHttpResources: true,
    originalCompleteStateAndGeometryCompared: true,
    worldRestorationsCompared: true,
    transferredOutputIsolationCompared: true,
    browserBundlesBuilt: true,
    mainViewerEnabled: false,
    gpuSubmissionObserved: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/ray-parent-workers-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
