// Full ordinary reconstruction in a module worker, using the selected static root.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [cacheArg, replayArg, endArg] = process.argv.slice(2);
if (!cacheArg || !replayArg || !endArg || process.argv.length !== 5)
  throw Error(
    "Usage: bun inspect-selected-reconstruction.mjs <cache> <replay.rofl> <end-seconds>",
  );
const cache = resolve(cacheArg),
  endTime = Number(endArg),
  inputs = {};
if (!Number.isFinite(endTime) || endTime <= 0)
  throw Error("Positive bounded replay time required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Reconstruction input changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const load = (path) => raw(`${cache}/public/${path}`),
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(import.meta.dir, "selected-reconstruction-worker.mjs"),
  ],
  raw,
);
const selected = await loadLatestStaticCatalogSelection({ load }),
  profile = selected.profile(),
  replay = await raw(replayArg),
  sceneBytes = await selected.readRole("scene"),
  scene = decode(sceneBytes),
  worldPath = `latest-scene/${scene.world}`,
  worldBytes = await selected.read(worldPath),
  staticAssets = { [worldPath]: worldBytes },
  payloadInputs = {
    buffer: replay.buffer.slice(
      replay.byteOffset,
      replay.byteOffset + replay.byteLength,
    ),
    profile,
    endTime,
    deltaMode: "signed8",
    image: await selected.read("decoder-16.21-macos/image.bin"),
    constructors: await load("decoder-16.21-macos/constructors.bin"),
    fieldCodecBytes: await load("decoder-16.21-macos/field-codecs.json"),
    worldSceneBytes: sceneBytes,
    worldCatalogBytes: worldBytes,
  };
for (const [key, path, role] of [
  ["startupConfigBytes", "latest-startup-config/package.json"],
  ["effectRemovalBytes", "latest-effect-removal/package.json"],
  ["effectCreationBytes", "latest-effect-creation/package.json"],
  ["effectPlacementBytes", null, "effectPlacement"],
  ["effectDescriptorBytes", null, "effectDescriptor"],
  ["appearanceStackInputBytes", "latest-appearance-stack-inputs/package.json"],
  ["unitFormInputBytes", "latest-unit-form-inputs/package.json"],
  ["missileTargetInputBytes", "latest-missile-targets/package.json"],
  ["targetVisibilityInputBytes", "latest-target-visibility/package.json"],
  [
    "targetVisibilityMaskInputBytes",
    "latest-target-visibility-masks/package.json",
  ],
  ["replicationBytes", "latest-replication/package.json"],
  ["championStateBytes", "latest-champion-state/package.json"],
  ["combatStatBytes", "latest-combat-stats/package.json"],
  ["experienceBytes", "latest-experience/package.json"],
  ["inventoryBytes", "latest-inventory/package.json"],
  ["corpsePolicyBytes", null, "corpsePolicy"],
  ["worldStateBytes", null, "worldState"],
])
  payloadInputs[key] = role
    ? await selected.readRole(role)
    : await selected.read(path);
const corpse = decode(await selected.readRole("corpsePolicyReference"));
for (const asset of Object.values(corpse.assets)) {
  const path = `latest-scene/${asset.catalog}`;
  staticAssets[path] = await selected.read(path);
}
const runtimePath = `${cache}/public/vendor/unicorn_x86_candidate.mjs`,
  runtimeManifest = decode(await raw(runtimePath.replace(/\.mjs$/, ".json")));
if ((await sha256(await raw(runtimePath))) !== runtimeManifest.sha256)
  throw Error("Original decoder runtime differs");
await raw(`${cache}/public/vendor/fzstd.mjs`);
const worker = new Worker(
  new URL("./selected-reconstruction-worker.mjs", import.meta.url),
  { type: "module" },
);
let result;
try {
  result = await new Promise((resolveResult, reject) => {
    const timer = setTimeout(
      () =>
        reject(Error("Selected reconstruction exceeded120s bounded control")),
      120000,
    );
    worker.onerror = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      data.ok
        ? resolveResult(data)
        : reject(Error(`${data.error.name}: ${data.error.message}`));
    };
    worker.postMessage({
      inputs: payloadInputs,
      initialization: selected.serializeForWorker(),
      staticAssets,
      runtimeModuleUrl: pathToFileURL(runtimePath).href,
      decompressModuleUrl: pathToFileURL(`${cache}/public/vendor/fzstd.mjs`)
        .href,
    });
  });
} finally {
  await worker.terminate();
}
if (
  !sameDirectCompiledData(result.catalog, selected.describe()) ||
  result.report.startup.configuredMapId !== scene.map.id ||
  result.report.replaySha256 !== (await sha256(replay))
)
  throw Error("Selected ordinary worker identity differs");
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Reconstruction input changed before publication: " + path);
const output = `${cache}/research/selected-reconstruction-control.json`,
  reportOutput = `${cache}/research/selected-ordinary-reconstruction.json`;
await Bun.write(reportOutput, JSON.stringify(result.report, null, 2));
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-selected-ordinary-reconstruction-control",
      inputs,
      catalog: selected.describe(),
      reportPath: resolve(reportOutput),
      reportSha256: await sha256(await Bun.file(reportOutput).bytes()),
      elapsedMs: result.elapsedMs,
      summary: result.report.summary,
      scope: {
        actualModuleWorker: true,
        ordinaryReconstructionFunction: true,
        decodedInWorker: true,
        selectedSceneNativeSchemaApproved: true,
        browserExecuted: false,
        effectsRendered: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    reportOutput,
    elapsedMs: result.elapsedMs,
    summary: result.report.summary,
  }),
);
