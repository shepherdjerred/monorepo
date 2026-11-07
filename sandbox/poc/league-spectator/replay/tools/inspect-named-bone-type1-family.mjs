// Actual shared targeted module-worker preparation and complete visual guards.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { prepareTargetedMissilePresentation } from "../latest-targeted-missile-worker.mjs";
import { requestTargetedMissilePresentation } from "../latest-targeted-missile-client.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Type1 family source changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const captured = decode(
    await raw(
      `${cache}/research/direct-session-selected-control-playback.json`,
    ),
  ),
  bytes = await raw(captured.decodedReport.path);
if ((await sha256(bytes)) !== captured.decodedReport.sha256)
  throw Error("Actual captured replay changed");
const report = decode(bytes),
  selected = await loadLatestStaticCatalogSelection({ load }),
  scene = decode(await selected.readRole("scene")),
  height = await selected.read("latest-scene/heights.bin"),
  payload = {
    family: "all",
    report,
    scene,
    profile: selected.profile(),
    heights: new Float32Array(
      height.buffer,
      height.byteOffset,
      height.byteLength / 4,
    ),
    world: {},
    staticCatalogInitialization: selected.serializeForWorker(),
  },
  staticAssets = {};
let synchronousPreparation, workerPreparation;
const reference = await prepareTargetedMissilePresentation(
  payload,
  async (path) => (staticAssets[path] ??= await load(path)),
  (metrics) => {
    synchronousPreparation = metrics;
  },
);
const actual = await requestTargetedMissilePresentation({
  ...payload,
  staticAssets,
  onPreparationMetrics: (metrics) => {
    workerPreparation = metrics;
  },
});
if (!sameDirectCompiledData(reference, actual))
  throw Error("Actual module worker named-source family differs");
const archiveBytes = await raw(
    resolve(".cache/replay-spike/research/direct-effects-v36-archive.json"),
  ),
  archive = decode(archiveBytes),
  baselineRow = archive.artifacts.find(
    (row) =>
      resolve(row.sourcePath) ===
      resolve(`${cache}/research/direct-session-selected-control.json`),
  );
if (!baselineRow) throw Error("Immutable V36 actual session baseline required");
const baselineBytes = await raw(baselineRow.archivePath);
if ((await sha256(baselineBytes)) !== baselineRow.sha256)
  throw Error("Archived actual session bytes changed");
const baseline = decode(baselineBytes).diagnostic.targetedMissilePresentation;
for (const trace of baseline.traces) {
  const current = actual.traces.find(
    (row) => row.sourceEventId === trace.sourceEventId,
  );
  if (!current || !sameDirectCompiledData(current, trace))
    throw Error(
      "Existing admitted missile trace changed: " + trace.sourceEventId,
    );
}
const oldFamilyRegression = {
  immutableBaselineVersion: 36,
  tracesCompared: baseline.traces.length,
  exactAllFields: true,
  archiveManifestSha256: await sha256(archiveBytes),
  archivedSessionSha256: baselineRow.sha256,
};
const source = decode(
    await raw(`${cache}/research/named-bone-type1-caster-inputs-v37.json`),
  ),
  native = decode(
    await raw(
      `${cache}/research/named-bone-type1-caster-start-comparison-v37.json`,
    ),
  );
if (
  native.mismatches.length ||
  native.lanesCompared !== 210 ||
  native.ownedProviderLanesCompared !== 35
)
  throw Error("Complete original type1 source comparison required");
for (const [path, digest] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error("Named type1 original comparison source changed: " + path);
const candidates = new Map(source.cases.map((row) => [row.sequence, row])),
  traces = actual.traces.filter((trace) => candidates.has(trace.sequence)),
  omitted = actual.omitted.filter((row) => candidates.has(row.sequence));
if (traces.length + omitted.length !== candidates.size)
  throw Error(
    "Every actual named source request must retain a lifecycle result",
  );
const preparedIds = new Map(),
  effects = decode(await selected.readRole("effects"));
for (const row of source.cases) {
  const hero = report.heroes.find(
      (hero) => hero.entityId === row.record.cast.ownerId,
    ),
    actor =
      effects.actors[`champions/${hero.champion.toLowerCase()}/${hero.skinId}`],
    binding = actor.missiles[row.record.cast.spellHash];
  if (binding.status !== "prepared-definition")
    throw Error("Actual source missile has no declared prepared definition");
  preparedIds.set(row.sequence, binding.effectId);
}
const compiled = await loadLatestDirectEffectPackage({
  load,
  manifestBytes: await selected.readRole("effects"),
  effectIds: [...new Set(preparedIds.values())],
  staticCatalog: selected,
});
const componentFrontier = [...compiled.definitions.values()].map(
  (definition) => ({
    id: definition.id,
    systemFlags: definition.systemFlags,
    blockers: definition.blockers,
    admittedComponents: definition.emitters.map((emitter) => ({
      index: emitter.index,
      primitive: emitter.primitive,
      materialKey: emitter.materialKey,
    })),
    unsupported: definition.unsupported,
  }),
);
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Type1 family inputs changed: " + path);
const output = `${cache}/research/named-bone-type1-family-control-v37.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-targeted-module-worker-named-type1-source-control",
      build: report.build,
      protocol: report.protocol,
      inputs,
      synchronousPreparation,
      workerPreparation,
      oldFamilyRegression,
      controls: {
        actualModuleWorker: true,
        exactSynchronousAgreement: true,
        originalSourceComparisonRequired: true,
        compilerMaterialGuardsUnchanged: true,
        everySourceCandidateAccounted: true,
      },
      candidates: source.cases.map((row) => ({
        sequence: row.sequence,
        sourceEventId: row.sourceEventId,
        ownerId: row.record.cast.ownerId,
        requestedTargetId:
          row.record.cast.requestedTargets[0].requestedEntityId,
        sourceResolved: row.pose.resolved,
        definitionId: preparedIds.get(row.sequence),
      })),
      traces,
      omitted,
      componentFrontier,
      scope: {
        suppliedCausalViewerPose: true,
        nativeLiveModelReady: false,
        nativeMatchAcceptance: false,
        webGlSubmitted: false,
        renderedCreatorClaim: false,
        workerPreparationOnlyNotPerFrame: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    candidates: candidates.size,
    traces: traces.length,
    omitted: omitted.map((row) => ({
      sequence: row.sequence,
      reasons: row.reasons,
    })),
    compiledComponents: componentFrontier.reduce(
      (sum, row) => sum + row.admittedComponents.length,
      0,
    ),
    workerPreparation,
    pins: Object.keys(inputs).length,
  }),
);
