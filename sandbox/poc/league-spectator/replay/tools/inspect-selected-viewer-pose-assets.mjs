import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { assertLatestViewerOrdinalJoints } from "../latest-viewer-ordinal-joints.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [selectedArgument, reportArgument, outputArgument] =
  process.argv.slice(2);
if (!outputArgument || process.argv.length !== 5)
  throw Error(
    "Usage: bun inspect-selected-viewer-pose-assets.mjs <selected-public-root> <decoded-report.json> <output.json>",
  );
const root = await realpath(path.resolve(selectedArgument)),
  inputs = {},
  sources = {};
async function source(file) {
  const bytes = await Bun.file(file).bytes();
  sources[file] = await sha256(bytes);
  return bytes;
}
const workerUrl = new URL("./selected-viewer-pose-worker.mjs", import.meta.url);
await captureDirectSourceInputs(
  [import.meta.path, fileURLToPath(workerUrl)],
  source,
);
const load = async (file) => {
  const candidate = await realpath(path.resolve(root, file));
  if (!candidate.startsWith(root + path.sep))
    throw Error("Selected pose resource escaped its closed public root");
  const bytes = await Bun.file(candidate).bytes();
  inputs[file] = { bytes: bytes.length, sha256: await sha256(bytes) };
  return bytes;
};
const selection = await loadLatestStaticCatalogSelection({ load }),
  profile = selection.profile(),
  scene = JSON.parse(
    new TextDecoder().decode(await selection.readRole("scene")),
  ),
  reportBytes = await Bun.file(reportArgument).bytes(),
  report = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(reportBytes),
  ),
  started = performance.now(),
  assets = await loadLatestViewerPoseAssets({
    profile,
    scene,
    report,
    load,
    staticCatalog: selection,
  });
let heroes = 0,
  joints = 0;
for (const hero of report.heroes) {
  joints += assertLatestViewerOrdinalJoints(
    assets.createEntry(hero.entityId),
  ).length;
  heroes++;
}
// A standalone pose-bundle transfer control. Full effect-session initialization
// separately requires both producer capabilities; this does not mint either.
const bundle = assets.serialize(),
  transfers = [
    ...new Set(Object.values(bundle.packages).map((bytes) => bytes.buffer)),
  ],
  transferredBytes = transfers.reduce(
    (total, buffer) => total + buffer.byteLength,
    0,
  ),
  worker = new Worker(workerUrl, { type: "module" });
let restored;
try {
  restored = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Pose resource worker exceeded60s")),
      60000,
    );
    worker.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    worker.onmessage = ({ data }) => {
      clearTimeout(timeout);
      data.ok ? resolve(data) : reject(Error(data.error));
    };
    worker.postMessage({ bundle, profile, scene, report }, transfers);
  });
} finally {
  await worker.terminate();
}
if (
  restored.contentHash !== assets.contentHash ||
  restored.heroes !== heroes ||
  restored.joints !== joints ||
  transfers.some((buffer) => buffer.byteLength !== 0)
)
  throw Error("Transferred static pose resources or original ordinals differ");
for (const [file, digest] of Object.entries(sources))
  if ((await sha256(await Bun.file(file).bytes())) !== digest)
    throw Error(
      `Pose resource control source changed during execution: ${file}`,
    );
const result = {
  schema: 1,
  kind: "selected-static-viewer-pose-resource-worker-control",
  scope: {
    originalOrdinalHierarchies: true,
    standalonePoseBundleTransfer: true,
    nativeControllerStateReconstructed: false,
    nativeSpectatorFidelity: false,
  },
  catalogSha256: selection.describe().catalogSha256,
  reportSha256: await sha256(reportBytes),
  heroes,
  joints,
  resources: Object.keys(bundle.packages).length,
  contentHash: assets.contentHash,
  restoredContentHash: restored.contentHash,
  transferredBuffers: transfers.length,
  transferredBytes,
  allTransferredBuffersDetached: true,
  elapsedMs: performance.now() - started,
  inputs,
  sources,
};
await Bun.write(outputArgument, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(outputArgument),
    heroes,
    joints,
    resources: result.resources,
    contentHash: result.contentHash,
    transferredBytes,
    elapsedMs: result.elapsedMs,
    nativeSpectatorAdmitted: false,
  }),
);
