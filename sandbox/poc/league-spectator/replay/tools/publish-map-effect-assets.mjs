// Verify generated map assets locally and selected dependencies on the private
// preview. This does not enable map effects in the main viewer.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[resolve(p)] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  files = new Map();
const systems = await read(`${assets}/latest-map-vfx-systems/package.json`),
  prepared = await read(`${assets}/latest-map-effect-assets/package.json`),
  cubes = await read(`${assets}/latest-map-dds-cubes/package.json`),
  memory = await read(`${cache}/research/map-byte-buffer-comparison.json`),
  activationPath = `${cache}/research/map-effect-activation.json`,
  activation = await read(activationPath);
check(
  systems.kind === "native-complete-map-vfx-systems" &&
    systems.build === "16.21.829.8620" &&
    systems.protocol === "20e09df23c66b85e" &&
    systems.counts.preparedRoots === 578 &&
    systems.counts.attemptedRoots === 578 &&
    systems.counts.directComplexEmitters === 4282 &&
    !systems.unprepared.length &&
    systems.counts.modeledByteBufferReserves === 15,
  "Complete exact-build map native asset preparation required",
);
check(
  prepared.kind === "prepared-map-effect-assets" &&
    prepared.mapSystemsSha256 ===
      inputs[resolve(`${assets}/latest-map-vfx-systems/package.json`)] &&
    prepared.counts.roots === 578 &&
    prepared.scope.constructorDefaultTexturesIncluded &&
    !prepared.scope.replayEventsConnected &&
    cubes.mapAssetsSha256 ===
      inputs[resolve(`${assets}/latest-map-effect-assets/package.json`)] &&
    cubes.scope.allAuthoredFacesAndMips,
  "Map asset/cube namespace identity differs",
);
check(
  memory.kind === "native-map-byte-buffer-comparison" &&
    memory.counts.cases === 10 &&
    memory.counts.mismatches === 0 &&
    memory.modeledService.sourceSha256 ===
      systems.modeledMemoryService.sourceSha256 &&
    memory.sources["map_vfx_asset_native.py"] ===
      systems.compilerSources["map_vfx_asset_native.py"],
  "Original byte-buffer comparison differs from map compiler",
);
check(
  activation.kind === "candidate-map-root-native-activation-observations" &&
    activation.counts.roots === 19 &&
    activation.scope.freshInterpreterPerCandidate &&
    activation.scope.catalogCandidateSelectionOnly &&
    !activation.scope.matchCreationImplemented &&
    !activation.scope.gpuDrawObserved &&
    !activation.scope.browserExecuted,
  "Complete isolated map activation observations required",
);
for (const proof of [memory, activation]) {
  for (const [name, digest] of Object.entries(proof.sources))
    check(
      sha(await raw(`${root}/tools/${name}`)) === digest,
      `Changed map observation source: ${name}`,
    );
  for (const [path, digest] of Object.entries(proof.inputs ?? {}))
    check(
      sha(await raw(path)) === digest,
      `Changed map observation input: ${path}`,
    );
}
for (const p of [systems, prepared, cubes]) {
  check(
    p.build === systems.build && p.protocol === systems.protocol,
    "Mixed map resource build/protocol",
  );
  for (const [name, digest] of Object.entries(p.compilerSources ?? p.sources))
    check(
      sha(await raw(`${root}/tools/${name}`)) === digest,
      `Changed map resource producer: ${name}`,
    );
}
async function add(directory, file, digest, http) {
  check(
    typeof file === "string" &&
      !file.startsWith("/") &&
      !file.includes(":") &&
      !file.split(/[\\/]/).some((p) => p === ".." || p === "."),
    "Invalid map publication asset path",
  );
  const path = `${assets}/${directory}/${file}`,
    bytes = await raw(path);
  check(
    sha(bytes) === digest,
    `Changed map resource bytes: ${directory}/${file}`,
  );
  if (http)
    files.set(`/assets/${directory}/${file}`, {
      path,
      sha256: digest,
      bytes: bytes.length,
    });
}
for (const directory of [
  "latest-map-vfx-systems",
  "latest-map-effect-assets",
  "latest-map-dds-cubes",
])
  await add(
    directory,
    "package.json",
    inputs[resolve(`${assets}/${directory}/package.json`)],
    true,
  );
const selected = new Set(activation.cases.map((c) => c.effectId)),
  selectedPaths = new Set();
for (const id of selected)
  for (const path of prepared.effects[id].dependencies) selectedPaths.add(path);
for (const [id, ref] of Object.entries(systems.systems))
  await add("latest-map-vfx-systems", ref.file, ref.sha256, selected.has(id));
let rawPaths = 0,
  convertedPaths = 0;
for (const [path, ref] of Object.entries(prepared.assets)) {
  if (ref.rawFile) {
    await add(
      "latest-map-effect-assets",
      ref.rawFile,
      ref.sourceSha256,
      selectedPaths.has(path),
    );
    rawPaths++;
  }
  if (ref.file) {
    check(ref.status === "prepared", "Unfinished map asset conversion");
    await add(
      "latest-map-effect-assets",
      ref.file,
      ref.sha256,
      selectedPaths.has(path),
    );
    convertedPaths++;
  }
}
for (const cube of Object.values(cubes.cubes))
  for (const level of cube.levels)
    for (const plane of level)
      await add("latest-map-dds-cubes", plane.file, plane.sha256, true);
// Prepared caches still contain host graphics metadata; verify locally only.
// No claim is made that those handles can be used by the browser.
for (const c of activation.cases)
  if (c.cache) {
    const record = await read(
      `${assets}/latest-map-effect-caches/${c.cache.file}`,
    );
    check(
      inputs[resolve(`${assets}/latest-map-effect-caches/${c.cache.file}`)] ===
        c.cache.sha256,
      "Map cache changed",
    );
    for (const ref of [...record.segments, ...record.imagePatches])
      await add("latest-map-effect-caches", ref.file, ref.sha256, false);
  }
let httpChecks = 0,
  receivedBytes = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  let next = 0;
  const entries = [...files];
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (next < entries.length) {
        const [path, ref] = entries[next++],
          response = await fetch(base + path, {
            signal: AbortSignal.timeout(15000),
          });
        check(
          response.status === 200,
          `Map resource HTTP status ${response.status}: ${base}${path}`,
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        check(
          sha(bytes) === ref.sha256,
          `Map resource HTTP bytes differ: ${base}${path}`,
        );
        httpChecks++;
        receivedBytes += bytes.length;
      }
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
  console.log(JSON.stringify({ base, files: files.size, httpChecks }));
}
const result = {
  schema: 1,
  kind: "private-map-effect-asset-publication",
  inputs,
  activationSha256: inputs[resolve(activationPath)],
  assetCounts: prepared.counts,
  activationCounts: activation.counts,
  files: Object.fromEntries(files),
  counts: {
    locallyVerifiedGraphs: Object.keys(systems.systems).length,
    locallyVerifiedRawAssetPaths: rawPaths,
    locallyVerifiedConvertedAssetPaths: convertedPaths,
    httpFiles: files.size,
    httpChecks,
    receivedBytes,
  },
  scope: {
    staticBuildResourcesOnly: true,
    httpSubset:
      "nineteen catalog candidate roots and their direct prepared dependencies, packages and cube planes",
    hostGraphicsCachesLocallyVerifiedOnly: true,
    mainViewerEnabled: false,
    replayEventsConnected: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/map-effect-assets-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    counts: result.counts,
    activationCounts: activation.counts,
  }),
);
