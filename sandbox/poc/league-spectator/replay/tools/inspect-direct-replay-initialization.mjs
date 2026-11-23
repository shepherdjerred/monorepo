import { resolve, join } from "node:path";
import { strict as assert } from "node:assert";
import { prepareDirectReplayFromFiles } from "./direct-replay-preparation.mjs";
const [configFile] = process.argv.slice(2);
if (!configFile)
  throw Error(
    "Usage: bun inspect-direct-replay-initialization.mjs <explicit-config.json>",
  );
const config = await Bun.file(configFile).json();
const result = await prepareDirectReplayFromFiles({
  ...config,
  onPreparation: (event) =>
    console.log(JSON.stringify({ phase: "preparation", ...event })),
});
const { live, runtimeInputs, api } = result;
let baselineCompared = false;
if (result.prepareBaseline) {
  const baseline = await result.prepareBaseline();
  for (const [name, before, after] of [
    ["events", baseline.events, live.events],
    ["contract", baseline.prepared.contract, live.prepared.contract],
    [
      "definitions",
      [...baseline.prepared.definitions],
      [...live.prepared.definitions],
    ],
    ["world-inputs", baseline.worldInputs, live.worldInputs],
    [
      "placement-policy",
      baseline.placementPolicy.metadata,
      live.placementPolicy.metadata,
    ],
    [
      "initial-resource-policy",
      baseline.initialResources?.policy.metadata ?? null,
      live.initialResources?.policy.metadata ?? null,
    ],
  ])
    assert(
      api.sameDirectCompiledData(before, after),
      `Preparation extraction changed actual ${name}`,
    );
  assert.equal(
    baseline.viewerPoseAssets.contentHash,
    live.viewerPoseAssets.contentHash,
  );
  baselineCompared = true;
}
const initialization = live.makeWorkerInitialization();
assert.throws(() => live.makeWorkerInitialization(), /one-use/);
assert.throws(
  () =>
    api.consumeDirectInitializationTransfer(
      initialization.ownedInitialization,
      { ...initialization.payload },
    ),
  /payload|ownership|owned|transfer/i,
);
// A rejected foreign-payload attempt consumes the original one-use ticket.
// It must never be accepted again, even with its original payload.
assert.throws(() =>
  api.consumeDirectInitializationTransfer(
    initialization.ownedInitialization,
    initialization.payload,
  ),
);
const kinds = {},
  selected = {},
  omitted = {};
for (const event of runtimeInputs.events) {
  kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
  if (event.kind === "create" && event.definitionId)
    selected[event.definitionId] = (selected[event.definitionId] ?? 0) + 1;
  if (event.kind === "omitted")
    for (const reason of event.reasons)
      omitted[reason] = (omitted[reason] ?? 0) + 1;
}
const definitions = [...live.prepared.definitions.values()].map(
  (definition) => ({
    id: definition.id,
    selectedCreations: selected[definition.id] ?? 0,
    blockers: definition.blockers,
    supported: definition.emitters.map((emitter) => ({
      index: emitter.index,
      primitive: emitter.primitive,
    })),
    unsupported: definition.unsupported,
  }),
);
await result.assertInputsUnchanged();
const report = {
  schema: 1,
  kind: "actual-direct-session-preparation-control",
  replaySha256: result.report.replaySha256,
  endTime: result.report.endTime,
  baselineCompared,
  ownershipNegatives: 3,
  events: runtimeInputs.events.length,
  kinds,
  selected,
  omitted,
  definitions,
  inputs: result.inputs,
  scope: {
    originalSessionPreparation: true,
    actualSourceOwnedPolicies: true,
    suppliedPlacement: false,
    targetedProviderIsActualWorkerImplementation: true,
    gpuSubmission: false,
    nativeSpectatorAdmitted: false,
  },
};
await Bun.write(
  join(resolve(config.outputDirectory), "initialization-control.json"),
  JSON.stringify(report),
);
console.log(
  JSON.stringify({
    output: config.outputDirectory,
    baselineCompared,
    events: report.events,
    kinds,
    definitions: definitions.length,
    supportedEmitters: definitions.reduce(
      (count, definition) => count + definition.supported.length,
      0,
    ),
  }),
);
