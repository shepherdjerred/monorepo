import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [cacheArg, reportArg] = process.argv.slice(2);
if (!cacheArg || !reportArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun inspect-selected-static-catalog.mjs <cache> <decoded-report>",
  );
const cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Selected inspector source changed");
  inputs[path] = hash;
  return bytes;
}
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(import.meta.dir, "selected-catalog-control-worker.mjs"),
  ],
  raw,
);
const selected = await loadLatestStaticCatalogSelection({ load }),
  profile = selected.profile(),
  scene = decode(await selected.readRole("scene")),
  document = decode(await raw(reportArg));
let report;
if (document.kind === "verified-ordinary-reconstruction-diagnostic-export") {
  if (
    document.runtimePlaybackInput !== false ||
    !document.report ||
    !document.inputs
  )
    throw Error("Explicit ordinary diagnostic export contract required");
  for (const [path, hash] of Object.entries(document.inputs))
    if ((await sha256(await raw(path))) !== hash)
      throw Error("Ordinary decoded report prerequisite changed: " + path);
  report = document.report;
} else {
  if (
    document.schema !== 1 ||
    document.build !== profile.clientVersion ||
    document.protocol !== profile.protocolDigest
  )
    throw Error("Exact decoded semantics report required");
  report = document;
}
const contexts = await createLatestEffectContexts({
  profile,
  packageBytes: await selected.readRole("effectContexts"),
  effectsManifestBytes: await selected.readRole("effects"),
  staticCatalog: selected,
});
const poses = await loadLatestViewerPoseAssets({
  profile,
  report,
  scene,
  load,
  staticCatalog: selected,
});
const resources = await loadLatestInitialResourcePrefix({
  profile,
  report,
  load,
  manifestBytes: await selected.readRole("effects"),
  staticCatalog: selected,
});
const resourceQueries = report.heroes.flatMap((hero) =>
  [0, 69, 99].map((time) => resources.policy.query(hero.entityId, time)),
);
const expectedActors = report.heroes.map((hero) => ({
  entityId: hero.entityId,
  actor: poses.actor(hero.entityId),
}));
const worker = new Worker(
  new URL("./selected-catalog-control-worker.mjs", import.meta.url),
  { type: "module" },
);
let result, poseInitialization, poseInitializationMs;
try {
  result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          Error("Selected catalog worker exceeded bounded initialization"),
        ),
      120000,
    );
    worker.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    worker.onmessage = ({ data }) => {
      clearTimeout(timeout);
      data.ok ? resolve(data) : reject(Error(data.error.message));
    };
    const started = performance.now();
    poseInitialization = poses.serializeForWorker();
    poseInitializationMs = performance.now() - started;
    const bundle = poseInitialization.value;
    (async () =>
      worker.postMessage(
        {
          bundle,
          initialization: await selected.bindWorkerInitialization(
            bundle.packages,
          ),
          profile,
          report,
          scene,
        },
        Object.values(bundle.packages).map((bytes) => bytes.buffer),
      ))().catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
} finally {
  await worker.terminate();
}
if (
  !sameDirectCompiledData(result.inventory, selected.describe()) ||
  result.contentHash !== poses.contentHash ||
  !sameDirectCompiledData(result.actors, expectedActors) ||
  !sameDirectCompiledData(result.resourceQueries, resourceQueries)
)
  throw Error(
    "Selected host/worker content or derived actor inventory differs",
  );
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Selected evidence source changed: " + path);
const output = `${cache}/research/selected-static-catalog-consumers.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-selected-context-and-viewer-pose-consumers",
      inputs,
      inventory: selected.describe(),
      contexts: contexts.metadata.contexts.length,
      actors: expectedActors,
      worker: result.scope,
      contentHash: poses.contentHash,
      resourceCounts: result.resourceCounts,
      resourceQueries: resourceQueries.length,
      initialization: {
        poseProducerCpuMs: poseInitializationMs,
        poseProducer: poseInitialization.initializationMetrics ?? null,
        mainSelectedInputs: selected.initializationMetrics(),
        workerSelectedInputs: result.selectedStaticInputs,
        transferEvidence: result.transferEvidence,
        catalogRootBuffersAliasOwnedPoseProducer: true,
      },
      scope: {
        strictOriginalContextObservation: true,
        fullSelectedInventoryAndPoseRestorationAgreement: true,
        actualSelectedResourcePoliciesAndQueries: true,
        nativeMaterialAdmissionEstablished: false,
        ordinarySessionComplete: false,
        renderedCoverageEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    contexts: contexts.metadata.contexts.length,
    actors: expectedActors.length,
    poseFiles: Object.keys(poseInitialization.value.packages).length,
    actualWorker: true,
    pins: Object.keys(inputs).length,
  }),
);
