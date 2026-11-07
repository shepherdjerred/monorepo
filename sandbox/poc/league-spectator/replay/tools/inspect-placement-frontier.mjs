// Inventory only: this never waives a placement gate or activates an effect.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
async function read(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}
inputs[import.meta.path] = await sha256(
  await Bun.file(import.meta.path).bytes(),
);
const session = await read(`${cache}/research/direct-session-control.json`);
if (
  session.completeCoverage.rows.some(
    (row) => typeof row.placementResolved !== "boolean",
  )
)
  throw Error("Current separate placement stage required");
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Verified ordinary diagnostic export required");
const { report } = exported;
const definitions = new Map(
  session.diagnostic.definitions.map((d) => [d.id, d]),
);
const descriptors = new Map();
for (const descriptor of report.effectDescriptors) {
  if (descriptors.has(descriptor.creationSequence))
    throw Error("Duplicate effect creation sequence");
  descriptors.set(descriptor.creationSequence, descriptor);
}
const candidates = [];
for (const row of session.completeCoverage.rows) {
  if (
    row.origin !== "network-effect" ||
    row.time < 69 ||
    row.time > 99 ||
    !row.resourceResolved ||
    row.placementResolved
  )
    continue;
  const definition = definitions.get(row.definitionId);
  if (!definition)
    throw Error(`Missing compiled definition: ${row.definitionId}`);
  if (!definition.supported.length || definition.blockers.length) continue;
  const descriptor = descriptors.get(row.entryOrder);
  if (
    !descriptor ||
    descriptor.entityId !== row.entityId ||
    descriptor.time !== row.time ||
    descriptor.transportSequence !== row.transportSequence
  )
    throw Error(`Creation/descriptor identity mismatch: ${row.id}`);
  const worldReasons = row.reasons.filter((reason) =>
    reason.startsWith("world:"),
  );
  if (!worldReasons.length)
    throw Error(`Missing placement omission: ${row.id}`);
  const d = descriptor;
  candidates.push({
    sourceEventId: row.id,
    generation: row.generation,
    time: row.time,
    transportSequence: row.transportSequence,
    entryOrder: row.entryOrder,
    definitionId: row.definitionId,
    programVersion: definition.programVersion,
    admittedComponentIds: definition.supported,
    resourcePolicy: row.resourceEvidence?.policy,
    resourceAssociatedChampion: row.definitionId.split("/")[1],
    worldReasons,
    entityReferences: row.entityReferences,
    flags: d.flags,
    attachmentKey4c: d.attachmentKey4c,
    attachmentKey50: d.attachmentKey50,
    vector6c: d.vector6c,
    vector6cBits: d.vector6cBits,
    byteFields: d.byteFields,
    primaryPacketPosition: d.primaryPacketPosition,
    nativeAcceptance: null,
    prospectiveOnly: true,
  });
}
function summarize(rows) {
  const byDefinition = {};
  for (const row of rows) {
    const item = (byDefinition[row.definitionId] ??= {
      requests: 0,
      admittedComponentIds: row.admittedComponentIds,
      resourceAssociatedChampion: row.resourceAssociatedChampion,
    });
    item.requests++;
  }
  return {
    requests: rows.length,
    definitions: Object.keys(byDefinition).length,
    resourceAssociatedChampions: [
      ...new Set(rows.map((r) => r.resourceAssociatedChampion)),
    ].sort(),
    prospectiveInstanceComponents: rows.reduce(
      (n, r) => n + r.admittedComponentIds.length,
      0,
    ),
    byDefinition,
    sourceEventIds: rows.map((r) => r.sourceEventId),
  };
}
const packetDirectionOnly = candidates.filter(
  (r) =>
    r.worldReasons.length === 1 &&
    r.worldReasons[0] === "world:authored-placement-direction-basis" &&
    !r.entityReferences.attachmentEntityId &&
    !r.entityReferences.lookup14EntityId &&
    !r.entityReferences.lookupA8EntityId &&
    !r.attachmentKey4c &&
    !r.attachmentKey50 &&
    !r.byteFields.field98 &&
    !(r.flags & 0x40),
);
const additionalProviderOnly = candidates.filter(
  (r) =>
    r.worldReasons.length === 1 &&
    r.worldReasons[0].startsWith("world:additional-transform-provider:"),
);
const groups = {};
for (const row of candidates) {
  const key = [...row.worldReasons].sort().join(" | ");
  (groups[key] ??= []).push(row);
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Input changed during frontier inventory: ${path}`);
const output = resolve(cache, "research/placement-frontier-ranking.json");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-resource-selected-placement-frontier-inventory",
      build: report.build,
      protocol: report.protocol,
      sourceInventoryProgramVersions: [
        ...new Set(candidates.map((r) => r.programVersion)),
      ],
      comparisonWindow: [69, 99],
      allCandidates: summarize(candidates),
      packetDirectionOnly: summarize(packetDirectionOnly),
      additionalProviderOnly: summarize(additionalProviderOnly),
      groups: Object.fromEntries(
        Object.entries(groups).map(([key, rows]) => [key, summarize(rows)]),
      ),
      candidates,
      inputs,
      scope: {
        actualDecodedRequests: true,
        existingCompiledPartialComponentInventory: true,
        resourceAssociationEstablishesOwnership: false,
        placementEligibilityWaived: false,
        newRuntimeActivationEstablished: false,
        prospectiveCountsAreRenderedCoverage: false,
        sourceReportsRetainTheirOwnVerificationTimesAndPolicies: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    all: summarize(candidates),
    packetDirectionOnly: summarize(packetDirectionOnly),
    additionalProviderOnly: summarize(additionalProviderOnly),
  }),
);
