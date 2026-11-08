// Static installed navigation only. No replay decoding or simulation runs here.
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import { validateDirectNavSceneSource } from "../latest-direct-nav-scene.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Navigation preparation input drift: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(`${cache}/research/navmesh-mask-source-native.json`),
  sourceProof = await read(
    `${cache}/research/navmesh-mask-source-comparison.json`,
  ),
  commandProof = await read(
    `${cache}/research/navmesh-producer-comparison.json`,
  ),
  gpuProof = await read(`${cache}/research/navmesh-producer-gpu-replay.json`),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes));
for (const proof of [sourceProof, commandProof, gpuProof]) {
  if (!Array.isArray(proof.mismatches) || proof.mismatches.length)
    throw Error("Exact navigation proof required");
  for (const [path, digest] of Object.entries(proof.inputs))
    if ((await sha256(await raw(path))) !== digest)
      throw Error(`Stale navigation proof: ${path}`);
}
if (
  native.boundary !== null ||
  !native.loader.completed ||
  sourceProof.nativeReportSha256 !==
    inputs[resolve(`${cache}/research/navmesh-mask-source-native.json`)] ||
  commandProof.counts.passesCompared !== 30 ||
  gpuProof.passes.length !== 30 ||
  !gpuProof.scope.allFinishedGlesPassPixelsExact ||
  gpuProof.scope.runtimeAdmissionChanged !== false
)
  throw Error(
    "Complete original source and finished producer GPU replay required",
  );
const o = native.observation,
  t = o.sceneTransform,
  source = {
    schema: 1,
    kind: "prepared-original-initial-nav-scene",
    build: native.build,
    protocol: native.protocol,
    sceneManifestSha256: await sha256(sceneBytes),
    selectedMap: Object.fromEntries(
      ["id", "variant", "selection", "navPath"].map((k) => [k, scene.map[k]]),
    ),
    navigation: {
      sourceSha256: scene.map.heightGrid.sourceSha256,
      width: o.width,
      height: o.height,
      rgbaHex: o.rgbaHex,
      rgbaSha256: o.sha256,
      cellFlagsHex: o.baseCellFlagsHex,
      cellSize: t.runtimeCellSize,
      origin: t.runtimeOrigin,
      center: t.center,
      extent: t.extent,
      transformHex: t.afterHex,
    },
    proofs: {
      sourceNativeSha256:
        inputs[resolve(`${cache}/research/navmesh-mask-source-native.json`)],
      sourceComparisonSha256:
        inputs[
          resolve(`${cache}/research/navmesh-mask-source-comparison.json`)
        ],
      producerComparisonSha256:
        inputs[resolve(`${cache}/research/navmesh-producer-comparison.json`)],
      producerGpuReplaySha256:
        inputs[resolve(`${cache}/research/navmesh-producer-gpu-replay.json`)],
    },
  };
const navInputs = Object.entries(native.inputs).filter(
  ([path, digest]) => digest === source.navigation.sourceSha256,
);
if (
  navInputs.length !== 1 ||
  (await sha256(await raw(navInputs[0][0]))) !== source.navigation.sourceSha256
)
  throw Error(
    "Original loaded navigation asset must be the selected scene asset",
  );
validateDirectNavSceneSource(source, scene, source.sceneManifestSha256);
if ((await sha256(Uint8Array.fromHex(o.rgbaHex))) !== o.sha256)
  throw Error("Native initial RGBA digest differs");
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Navigation input changed: ${path}`);
const directory = `${cache}/public/latest-direct-nav-scene`;
await mkdir(directory, { recursive: true });
const packageBytes = new TextEncoder().encode(JSON.stringify(source)),
  packageSha256 = await sha256(packageBytes);
await Bun.write(`${directory}/package.json`, packageBytes);
await Bun.write(
  `${cache}/research/direct-nav-scene-preparation.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "static-selected-scene-navigation-preparation",
      inputs,
      packageSha256,
      sourceBytes: packageBytes.length,
      sceneManifestSha256: source.sceneManifestSha256,
      scope: {
        offlineMatchDecoding: false,
        offlineSimulation: false,
        initialInstalledNavigationOnly: true,
        decodedSceneSelection: false,
        dynamicMutations: false,
        runtimeAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ directory, packageSha256, bytes: packageBytes.length }),
);
