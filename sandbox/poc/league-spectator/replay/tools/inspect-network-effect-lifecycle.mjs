// Actual decoded requests exercise the ordinary event builder. This does not
// establish native world lookup, removal execution or retirement readiness.
import { resolve } from "node:path";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
import { buildLatestDirectEffectEvents } from "../latest-world-presentation.mjs";
import { NETWORK_EFFECT_LIFECYCLE_POLICY } from "../latest-network-effect-lifecycle.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Ordinary raw reconstruction diagnostic required");
const { report } = exported,
  pipeline = await createLatestEffectPipeline({
    report,
    effectsManifestBytes: await load("latest-effects/manifest.json"),
    quadGpuBytes: await load("latest-complete-quad-gpu/package.json"),
    trailGpuBytes: await load("latest-trail-particles/gpu.json"),
  }),
  events = buildLatestDirectEffectEvents({ pipeline, report }),
  network = events.filter((event) => event.origin === "network-effect"),
  creations = network.filter((event) =>
    ["create", "omitted"].includes(event.kind),
  ),
  removals = network.filter((event) => event.kind === "removal-request");
if (
  creations.length !== report.effectCreations.length ||
  removals.length !== report.effectRemovals.length
)
  throw Error("Incomplete ordinary network lifecycle");
const latest = new Map(),
  generations = new Map(),
  reasonBytes = {},
  linked = [],
  missing = [],
  removalCounts = new Map();
for (const event of network) {
  if (event.kind !== "removal-request") {
    const generation = (generations.get(event.entityId) ?? 0) + 1;
    generations.set(event.entityId, generation);
    if (
      event.generation !== generation ||
      event.creationInput.nativeWorldLookupAcceptance !== null
    )
      throw Error(
        "Creation generation differs from independently replayed ledger",
      );
    latest.set(event.entityId, event);
    continue;
  }
  const target = latest.get(event.entityId),
    input = event.removalInput;
  reasonBytes[input.reasonByte] = (reasonBytes[input.reasonByte] ?? 0) + 1;
  if (
    input.nativeWorldLookupAcceptance !== null ||
    input.requestedFlagMask !== (input.reasonByte === 61 ? 0x800 : 0x10000000)
  )
    throw Error("Removal byte branch or acceptance changed");
  if (!target) {
    if (
      input.targetCreation !== null ||
      event.sourceEventId !== null ||
      event.generation !== null
    )
      throw Error("Unobserved creation acquired a target");
    missing.push(event.id);
    continue;
  }
  const observed = input.targetCreation;
  for (const key of [
    "entityId",
    "time",
    "transportSequence",
    "entryOrder",
    "generation",
    "creationSequence",
  ])
    if (observed[key] !== target[key])
      throw Error(`Target tuple differs: ${key}`);
  if (event.sourceEventId !== target.id || observed.sourceEventId !== target.id)
    throw Error("Removal targets a foreign creation");
  for (const key of [
    "resourceContextEntityId",
    "lookup14EntityId",
    "attachmentEntityId",
    "lookupA8EntityId",
  ])
    if (observed.entityReferences[key] !== target.descriptor[key])
      throw Error("Entity reference lost");
  linked.push(event.id);
  removalCounts.set(target.id, (removalCounts.get(target.id) ?? 0) + 1);
}
const windowRemovals = removals.filter(
  (event) => event.time >= 69 && event.time <= 99,
);
const result = {
  schema: 1,
  kind: "ordinary-network-effect-lifecycle-linker-control",
  policy: NETWORK_EFFECT_LIFECYCLE_POLICY,
  creationRequests: creations.length,
  removalRequests: removals.length,
  reasonBytes,
  linkedRequests: linked.length,
  noDecodedPriorCreation: missing.length,
  uniqueLinkedCreations: removalCounts.size,
  repeatedRemovalCreationCount: [...removalCounts.values()].filter(
    (count) => count > 1,
  ).length,
  comparisonWindow: {
    time: [69, 99],
    removalRequests: windowRemovals.length,
    linkedRequests: windowRemovals.filter(
      (event) => event.removalInput.targetCreation !== null,
    ).length,
  },
  controls: {
    fullOrdinaryBuilder: true,
    everyCreationIncludingOmittedHasGeneration: true,
    exactCausalTargetAndFourReferences: true,
    noCrossOriginRouting: true,
    noRuntimeFlagSeeds: true,
    nativeWorldLookupAcceptance: null,
    nativeRetirementExecuted: false,
    runtimeLifecycleExecuted: false,
  },
  missingRequestIds: missing,
  inputs,
};
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const output = `${cache}/research/network-effect-lifecycle-control.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    ...result,
    missingRequestIds: undefined,
    inputs: Object.keys(inputs).length,
  }),
);
