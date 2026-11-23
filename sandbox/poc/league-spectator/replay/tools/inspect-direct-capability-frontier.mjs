// Actual recorded creation/resource/placement frontier. No supplied pose or
// hypothetical field removal can contribute to the resolved input counts.
import { resolve, join } from "node:path";
import { prepareDirectReplayFromFiles } from "./direct-replay-preparation.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";

const [configFile] = process.argv.slice(2);
if (!configFile)
  throw Error(
    "Usage: bun inspect-direct-capability-frontier.mjs <explicit-config.json>",
  );
const sourceSha256 = sha(await Bun.file(import.meta.path).bytes());
const config = await Bun.file(configFile).json();
const result = await prepareDirectReplayFromFiles({
  ...config,
  onPreparation: (event) =>
    console.log(JSON.stringify({ phase: "preparation", ...event })),
});
if (!result.staticCatalog)
  throw Error("Explicit selected authority required for material frontier");
const quad = JSON.parse(
  new TextDecoder().decode(await result.staticCatalog.readRole("quadGpu")),
);
const materialKeys = new Set(
  quad.emitters.map((row) => `${row.effectId}:${row.emitterIndex}`),
);
const byDefinition = new Map();
const increment = (target, key) => {
  target[key] = (target[key] ?? 0) + 1;
};
const finite = (value, length) =>
  Array.isArray(value) &&
  value.length === length &&
  Array.from(value).every(Number.isFinite);
let creations = 0;
for (const event of result.runtimeInputs.events) {
  if (event.kind !== "create") continue;
  creations++;
  let row = byDefinition.get(event.definitionId);
  if (!row) {
    row = {
      id: event.definitionId,
      creations: 0,
      resolvedPlacements: 0,
      resolvedBasis: 0,
      resolvedBoundSize: 0,
      resolvedBasisAndBoundSize: 0,
      reasons: {},
      policies: {},
      examples: [],
    };
    byDefinition.set(event.definitionId, row);
  }
  row.creations++;
  const cursor = {
    transportSequence: event.transportSequence,
    entryOrder: event.entryOrder,
  };
  const placement = result.live.presentationWorld.placement(
    event,
    event.time,
    cursor,
  );
  if (event.placement?.kind === "explicit-world")
    throw Error(
      "Recorded source frontier cannot count supplied world placement",
    );
  const basis = placement.resolved === true && finite(placement.basis, 9);
  const bound =
    placement.resolved === true &&
    typeof placement.boundObjectSize === "number" &&
    Number.isFinite(Math.fround(placement.boundObjectSize)) &&
    placement.boundObjectSize >= 0;
  if (placement.resolved === true) row.resolvedPlacements++;
  if (basis) row.resolvedBasis++;
  if (bound) row.resolvedBoundSize++;
  if (basis && bound) row.resolvedBasisAndBoundSize++;
  increment(row.policies, placement.policy ?? "undeclared");
  for (const reason of placement.reasons ?? []) increment(row.reasons, reason);
  if (row.examples.length < 2)
    row.examples.push({
      id: event.id,
      time: event.time,
      cursor,
      resolved: placement.resolved,
      policy: placement.policy ?? null,
      basis: basis ? placement.basis : null,
      boundObjectSize: bound ? placement.boundObjectSize : null,
      reasons: placement.reasons ?? [],
    });
}
const definitions = [...result.live.prepared.definitions.values()].map(
  (definition) => ({
    ...byDefinition.get(definition.id),
    id: definition.id,
    blockers: definition.blockers,
    compiled: definition.emitters.map((emitter) => ({
      index: emitter.index,
      requirements: emitter.placementRequirements,
    })),
    unsupported: definition.unsupported.map((emitter) => ({
      ...emitter,
      matchingPreparedMaterial: materialKeys.has(
        `${definition.id}:${emitter.index}`,
      ),
    })),
  }),
);
await result.assertInputsUnchanged();
if (sha(await Bun.file(import.meta.path).bytes()) !== sourceSha256)
  throw Error("Capability frontier producer changed during run");
const report = {
  schema: 1,
  kind: "actual-recorded-direct-capability-frontier",
  sourceSha256,
  replaySha256: result.report.replaySha256,
  endTime: result.report.endTime,
  events: result.runtimeInputs.events.length,
  creations,
  definitions,
  inputs: result.inputs,
  scope: {
    actualSessionPreparation: true,
    actualRecordedCreationPlacement: true,
    suppliedPlacement: false,
    fieldsRemovedForEligibility: false,
    materialAcquisitionInvented: false,
    replayActivationProved: false,
    gpuSubmission: false,
    nativeSpectatorAdmitted: false,
  },
};
const output = join(
  resolve(config.outputDirectory),
  "capability-frontier.json",
);
await Bun.write(output, JSON.stringify(report));
console.log(
  JSON.stringify({
    output,
    events: report.events,
    creations,
    definitions: definitions.length,
    resolvedPlacements: [...byDefinition.values()].reduce(
      (n, row) => n + row.resolvedPlacements,
      0,
    ),
    resolvedBasis: [...byDefinition.values()].reduce(
      (n, row) => n + row.resolvedBasis,
      0,
    ),
    resolvedBoundSize: [...byDefinition.values()].reduce(
      (n, row) => n + row.resolvedBoundSize,
      0,
    ),
  }),
);
