// Compare immutable increment archives, preserving creation generations and
// component identities. Prefix contributions are not final visible pixels.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  beforeVersion = Number(process.argv[3]),
  afterVersion = Number(process.argv[4]),
  afterRasterOverride = process.argv[5] ? resolve(process.argv[5]) : null,
  inputs = {};
if (
  ![beforeVersion, afterVersion].every(
    (n) => Number.isSafeInteger(n) && n > 0,
  ) ||
  afterVersion <= beforeVersion
)
  throw Error("Ordered positive archive versions required");
async function read(path) {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
inputs[import.meta.path] = await sha256(
  await Bun.file(import.meta.path).bytes(),
);
const cohorts = {};
for (const name of ["shared-direct"]) {
  const versions = [];
  for (const version of [beforeVersion, afterVersion]) {
    const raster = await read(
        version === afterVersion && afterRasterOverride
          ? afterRasterOverride
          : resolve(
              cache,
              `research/${name}-playback-offscreen-v${version}.json`,
            ),
      ),
      worker = await read(
        resolve(
          cache,
          `research/${name}-playback-worker-v${version}-final.json`,
        ),
      );
    if (
      raster.scope?.offscreenGpuSubmission !== true ||
      raster.scope?.perSubmissionPrefixFramebufferChangesEstablished !== true ||
      raster.scope?.worldSceneRendered !== false ||
      JSON.stringify(worker.comparisonWindow) !== JSON.stringify([69, 99]) ||
      !Array.isArray(raster.frames)
    )
      throw Error(
        "Matching actual comparison-window worker/raster archives required",
      );
    const workerPath = resolve(
        cache,
        `research/${name}-playback-worker-v${version}-final.json`,
      ),
      workerPins = Object.entries(raster.inputs).filter(([path]) =>
        /[\\/]shared-direct-playback-worker\.json$/.test(path),
      );
    if (workerPins.length !== 1 || workerPins[0][1] !== inputs[workerPath])
      throw Error(
        "Raster must pin the exact immutable worker bytes being compared",
      );
    const components = new Map();
    for (const frame of raster.frames) {
      if (!Number.isFinite(frame.time) || frame.time < 69 || frame.time > 99)
        throw Error("Comparison-window raster frame required");
      for (const draw of frame.draws) {
        if (!(draw.prefixFramebufferChangedPixels > 0)) continue;
        if (
          typeof draw.sourceEventId !== "string" ||
          !Number.isSafeInteger(draw.generation) ||
          draw.generation < 1 ||
          typeof draw.definitionId !== "string" ||
          !Number.isSafeInteger(draw.emitterId) ||
          draw.emitterId < 0
        )
          throw Error(
            "Traceable source, generation and component identity required",
          );
        const key = JSON.stringify([
          draw.sourceEventId,
          draw.generation,
          draw.definitionId,
          draw.emitterId,
        ]);
        components.set(key, {
          sourceEventId: draw.sourceEventId,
          generation: draw.generation,
          definitionId: draw.definitionId,
          emitterId: draw.emitterId,
        });
      }
    }
    if (components.size !== raster.counts.prefixContributingComponents)
      throw Error(
        "Raster component summary differs from submitted draw evidence",
      );
    versions.push({ version, raster, worker, components });
  }
  const [before, after] = versions;
  if (
    JSON.stringify(before.raster.projection) !==
      JSON.stringify(after.raster.projection) ||
    JSON.stringify(before.worker.sourceCounts) !==
      JSON.stringify(after.worker.sourceCounts) ||
    JSON.stringify(before.worker.snapshots.map((f) => f.camera)) !==
      JSON.stringify(after.worker.snapshots.map((f) => f.camera)) ||
    JSON.stringify(before.raster.frames.map((f) => f.time)) !==
      JSON.stringify(after.raster.frames.map((f) => f.time))
  )
    throw Error(
      "Coverage increments require the same projection, source categories and sample clock",
    );
  const added = [...after.components]
      .filter(([key]) => !before.components.has(key))
      .map(([, row]) => row),
    removed = [...before.components]
      .filter(([key]) => !after.components.has(key))
      .map(([, row]) => row),
    byDefinitionEmitter = {};
  for (const row of added) {
    const key = `${row.definitionId}:${row.emitterId}`;
    byDefinitionEmitter[key] = (byDefinitionEmitter[key] ?? 0) + 1;
  }
  cohorts[name] = {
    before: {
      version: before.version,
      counts: before.raster.counts,
      stages: before.worker.allStages,
    },
    after: {
      version: after.version,
      counts: after.raster.counts,
      stages: after.worker.allStages,
    },
    addedComponents: added,
    removedComponents: removed,
    addedByDefinitionEmitter: byDefinitionEmitter,
  };
}
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Coverage comparison input changed: ${path}`);
const output = resolve(
  cache,
  `research/direct-effects-delta-v${afterVersion}.json`,
);
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "offscreen-direct-playback-coverage-delta",
      beforeVersion,
      afterVersion,
      afterRasterOverride,
      inputs,
      cohorts,
      scope: {
        historicalArchivesCompared: afterRasterOverride === null,
        immutableWorkerArchivesCompared: true,
        effectSpecificPreparationWindows: false,
        finalUnoccludedVisibilityEstablished: false,
        definitionFamiliesEstablishCreatorAttribution: false,
        browserAcceptance: false,
        fullWorldPerformanceAcceptance: false,
        completeEffectFidelity: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    inputs: Object.keys(inputs).length,
    cohorts: Object.fromEntries(
      Object.entries(cohorts).map(([name, row]) => [
        name,
        {
          added: row.addedComponents.length,
          removed: row.removedComponents.length,
          byDefinitionEmitter: row.addedByDefinitionEmitter,
        },
      ]),
    ),
  }),
);
