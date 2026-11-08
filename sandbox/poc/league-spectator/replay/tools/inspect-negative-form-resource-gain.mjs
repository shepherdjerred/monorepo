// Research ranking only. The alternate inventory below is explicitly
// counterfactual until the complete original form producer is proven.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import {
  createLatestWorldPresentation,
  buildLatestDirectEffectEvents,
} from "../latest-world-presentation.mjs";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import { createLatestViewerRootAttachmentPlacement } from "../latest-viewer-root-attachment.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { directComponentWorldInputOmissions } from "../latest-direct-effect-world-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return data;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.runtimePlaybackInput !== false ||
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export"
)
  throw Error("Verified ordinary diagnostic export required");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale reconstruction: ${path}`);
const { report } = exported,
  manifestBytes = await load("latest-effects/manifest.json");
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  scene = await read(`${cache}/public/latest-scene/manifest.json`);
const heightBytes = await load("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heightBytes.buffer,
      heightBytes.byteOffset,
      heightBytes.byteLength / 4,
    ),
  );
const filtered = report.resourceRequests.filter(
  (event) =>
    event.opcode === 129 && event.signedIndex < 0 && event.nativeFlag === false,
);
const hypotheticalReport = {
  ...report,
  resourceRequests: report.resourceRequests.filter(
    (event) => !filtered.includes(event),
  ),
};
const baseline = await loadLatestInitialResourcePrefix({
  profile,
  load,
  manifestBytes,
  report,
});
const hypothetical = await loadLatestInitialResourcePrefix({
  profile,
  load,
  manifestBytes,
  report: hypotheticalReport,
});
const units = await createLatestUnitResources({
  profile,
  resolvers: baseline.resolvers,
  packageBytes: await load("latest-unit-resources/package.json"),
});
const pipeline = baseline.resolvers.bindTimeline(
  await createLatestEffectPipeline({
    report,
    effectsManifestBytes: manifestBytes,
    quadGpuBytes: await load("latest-complete-quad-gpu/package.json"),
    trailGpuBytes: await load("latest-trail-particles/gpu.json"),
  }),
  report,
);
const definitions = new Map(),
  placement = createLatestViewerRootAttachmentPlacement({
    profile,
    definitions,
    packetPlacement: await createLatestDirectEffectPlacement({
      profile,
      packageBytes: await load("latest-world-descriptor-abi/package.json"),
    }),
  });
const worlds = [baseline, hypothetical].map(({ policy }) =>
  createLatestWorldPresentation({
    report,
    scene,
    terrain,
    initialResourcePrefix: policy,
    placementResolver: placement.resolve,
  }),
);
const events = worlds.map((world) =>
  buildLatestDirectEffectEvents({
    pipeline,
    report,
    world,
    unitResources: units,
  }),
);
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: events.flatMap((list) =>
    list.flatMap((event) =>
      [event.definitionId, event.auxiliaryCandidateDefinitionId].filter(
        Boolean,
      ),
    ),
  ),
});
for (const [id, definition] of prepared.definitions)
  definitions.set(id, definition);
const classify = (list, world) =>
  list
    .filter(
      (event) =>
        event.origin === "network-effect" &&
        event.kind !== "removal-request" &&
        event.time >= 69 &&
        event.time <= 99,
    )
    .map((event) => {
      const definition = definitions.get(event.definitionId),
        resourceResolved = event.kind === "create";
      const placed = resourceResolved
        ? world.placement(event, event.time, {
            transportSequence: event.transportSequence,
            entryOrder: event.entryOrder,
          })
        : null;
      const eligible = placed?.resolved
        ? definition.emitters.filter(
            (emitter) =>
              !directComponentWorldInputOmissions(emitter, placed).length,
          )
        : [];
      return {
        id: event.id,
        entityId: event.entityId,
        definitionId: event.definitionId ?? null,
        resourceResolved,
        placementResolved: placed?.resolved ?? false,
        worldInputsResolved: !!placed?.resolved && eligible.length > 0,
        allCompiledComponentInputsResolved:
          !!placed?.resolved &&
          definition.emitters.length > 0 &&
          eligible.length === definition.emitters.length,
        compiledComponentCount: definition?.emitters.length ?? 0,
        eligibleComponentCount: eligible.length,
        activationEligible: !!(
          placed?.resolved &&
          eligible.length &&
          !definition.blockers.length
        ),
        emitters: definition?.emitters.map((emitter) => emitter.index) ?? [],
        reasons: [
          ...(event.reasons ?? []),
          ...(placed?.reasons ?? []),
          ...(definition?.blockers ?? []),
        ],
      };
    });
const actual = classify(events[0], worlds[0]),
  conditional = classify(events[1], worlds[1]);
const byId = new Map(actual.map((row) => [row.id, row]));
const changed = conditional.filter((row) =>
  [
    "resourceResolved",
    "placementResolved",
    "worldInputsResolved",
    "allCompiledComponentInputsResolved",
    "activationEligible",
  ].some((field) => row[field] !== byId.get(row.id)[field]),
);
const summarize = (rows) =>
  Object.fromEntries(
    [
      "resourceResolved",
      "placementResolved",
      "worldInputsResolved",
      "allCompiledComponentInputsResolved",
      "activationEligible",
    ].map((key) => [key, rows.filter((row) => row[key]).length]),
  );
const result = {
  schema: 1,
  kind: "unproven-negative-form-producer-resource-gain-ranking",
  inputs,
  actual: summarize(actual),
  conditional: summarize(conditional),
  changed,
  ignoredRequestsForCounterfactualOnly: filtered.map((event) => ({
    id: event.id,
    entityId: event.entityId,
    time: event.time,
    stream: event.stream,
    index: event.index,
    signedIndex: event.signedIndex,
    nativeFlag: event.nativeFlag,
  })),
  conditionalOwners: report.heroes
    .filter((hero) =>
      changed.some((row) =>
        events[1]
          .find((event) => event.id === row.id)
          ?.resourceSelection?.presentation?.units.some(
            (unit) => unit.entityId === hero.entityId,
          ),
      ),
    )
    .map((hero) => ({ entityId: hero.entityId, champion: hero.champion })),
  scope: {
    researchCounterfactualOnly: true,
    complete129ProducerProven: false,
    nativeMatchAcceptance: null,
    productionPolicyChanged: false,
    runtimeActivationPerformed: false,
    geometryGenerated: false,
    gpuSubmission: false,
  },
};
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Input changed: ${path}`);
const output = `${cache}/research/negative-form-resource-gain-ranking.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    actual: result.actual,
    conditional: result.conditional,
    conditionalOwners: result.conditionalOwners,
    changed: changed.length,
    activationCandidates: changed.filter((row) => row.activationEligible),
    inputs: Object.keys(inputs).length,
  }),
);
