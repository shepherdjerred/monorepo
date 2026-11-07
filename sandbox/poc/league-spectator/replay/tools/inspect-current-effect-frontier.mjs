// Current ordinary-stream inventory only. No eligibility, ownership or runtime
// input is synthesized by this diagnostic.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { DIRECT_EFFECT_PROGRAM_VERSION } from "../latest-direct-effect-runtime.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const worker = await read(
    `${cache}/research/shared-direct-playback-worker.json`,
  ),
  session = await read(`${cache}/research/direct-session-control.json`),
  exported = await read(`${cache}/research/viewer-root-reconstruction.json`);
for (const evidence of [worker, session, exported])
  for (const [path, hash] of Object.entries(evidence.inputs))
    if ((await sha256(await raw(path))) !== hash)
      throw Error(`Stale current evidence: ${path}`);
if (
  worker.schedules.some(
    (s) => s.summary.contract.runtimeVersion !== DIRECT_EFFECT_PROGRAM_VERSION,
  ) ||
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error(
    `Current v${DIRECT_EFFECT_PROGRAM_VERSION} ordinary worker evidence required`,
  );
const manifest = await read(`${cache}/public/latest-effects/manifest.json`),
  definitions = new Map(session.diagnostic.definitions.map((d) => [d.id, d])),
  descriptors = new Map(
    exported.report.effectDescriptors.map((d) => [d.creationSequence, d]),
  ),
  rows = worker.schedules[0].coverage.rows.filter(
    (r) => r.origin === "network-effect" && r.time >= 69 && r.time <= 99,
  );
if (rows.length !== 1110)
  throw Error("All 1110 current network creations required");
const selected = rows.filter((r) => r.resourceResolved),
  byDefinition = new Map();
const generatedDefinitions = new Set(
  worker.schedules[0].coverage.rows
    .filter(
      (r) =>
        r.time >= 69 &&
        r.time <= 99 &&
        r.runtimeActivated &&
        r.componentsGenerated?.length > 0,
    )
    .map((r) => r.definitionId),
);
const stage = (list) => ({
  requests: list.length,
  resourceResolved: list.filter((r) => r.resourceResolved).length,
  placementResolved: list.filter((r) => r.placementResolved).length,
  componentWorldInputsResolved: list.filter((r) => r.worldInputsResolved)
    .length,
  runtimeActivated: list.filter((r) => r.runtimeActivated).length,
});
for (const row of selected) {
  if (typeof row.placementResolved !== "boolean")
    throw Error("Separate placement stage required");
  if (!byDefinition.has(row.definitionId))
    byDefinition.set(row.definitionId, []);
  byDefinition.get(row.definitionId).push(row);
}
const componentCandidates = [],
  dependencyGroups = new Map(),
  fidelityGroups = new Map(),
  rootGroups = new Map();
function add(group, key, row, component) {
  if (!group.has(key))
    group.set(key, {
      requestIds: new Set(),
      componentIds: new Set(),
      instanceComponents: 0,
      placementResolvedInstanceComponents: 0,
      definitions: new Set(),
      placementResolvedRequestIds: new Set(),
      placementResolvedDefinitions: new Set(),
    });
  const value = group.get(key);
  value.requestIds.add(row.id);
  value.componentIds.add(`${row.definitionId}:${component}`);
  value.instanceComponents++;
  value.placementResolvedInstanceComponents += row.placementResolved;
  value.definitions.add(row.definitionId);
  if (row.placementResolved) {
    value.placementResolvedRequestIds.add(row.id);
    value.placementResolvedDefinitions.add(row.definitionId);
  }
}
function requiredInputs(d) {
  return {
    entityReferences: Object.fromEntries(
      [
        "resourceContextEntityId",
        "attachmentEntityId",
        "lookup14EntityId",
        "lookupA8EntityId",
      ].map((k) => [k, d[k]]),
    ),
    sourceKey: d.attachmentKey4c,
    targetKey: d.attachmentKey50,
    sourceMatrixRequired: d.attachmentEntityId !== 0 && (d.flags & 0x10) === 0,
    flags: d.flags,
    field8c: d.field8c,
    field98: d.byteFields.field98,
    packetPosition: d.primaryPacketPosition,
    packetSecondaryVector: d.secondaryPacketVector,
    packetDirection: d.vector6c,
  };
}
for (const [definitionId, requests] of byDefinition) {
  const compiled = definitions.get(definitionId),
    ref = manifest.definitions[definitionId];
  if (!compiled || !ref)
    throw Error(`Missing compiled/raw definition: ${definitionId}`);
  const bytes = await raw(`${cache}/public/latest-effects/${ref.file}`);
  if ((await sha256(bytes)) !== ref.sha256)
    throw Error(`Raw definition hash differs: ${definitionId}`);
  const source = JSON.parse(new TextDecoder().decode(bytes)).definition;
  for (const blocked of compiled.unsupported) {
    const alreadyCompiled = compiled.supported.includes(blocked.index);
    const authored = Number.isInteger(blocked.index)
      ? source.complexEmitterDefinitionData?.[blocked.index]
      : null;
    const primitive =
        authored?.primitive?.__type ??
        (authored
          ? "VfxPrimitiveCameraQuad(default)"
          : "simple-emitter-or-unclassified"),
      shape =
        authored?.SpawnShape?.__type ??
        "constructor-default-or-other-shape-source",
      worldReasons = {},
      inputCases = [];
    for (const row of requests) {
      const d = descriptors.get(row.entryOrder);
      if (
        !d ||
        d.entityId !== row.entityId ||
        d.time !== row.time ||
        d.transportSequence !== row.transportSequence
      )
        throw Error(`Exact creation/descriptor identity required: ${row.id}`);
      for (const reason of row.reasons.filter((r) => r.startsWith("world:")))
        worldReasons[reason] = (worldReasons[reason] ?? 0) + 1;
      for (const reason of blocked.reasons.filter(
        (reason) => reason !== "authored-disabled",
      ))
        add(
          alreadyCompiled ? fidelityGroups : dependencyGroups,
          reason,
          row,
          blocked.index,
        );
      for (const reason of compiled.blockers)
        add(rootGroups, reason, row, blocked.index);
      inputCases.push({
        sourceEventId: row.id,
        generation: row.generation,
        time: row.time,
        transportSequence: row.transportSequence,
        entryOrder: row.entryOrder,
        placementResolved: row.placementResolved,
        componentWorldInputsResolved: row.worldInputsResolved,
        inputs: requiredInputs(d),
        placementReasons: row.reasons.filter((r) => r.startsWith("world:")),
      });
    }
    componentCandidates.push({
      definitionId,
      additionalDefinitionCandidate: !generatedDefinitions.has(definitionId),
      emitterId: blocked.index,
      alreadyCompiled,
      authoredDisabled: blocked.reasons.includes("authored-disabled"),
      omissionCategory: alreadyCompiled
        ? "compiled-component-partial-omission"
        : "component-not-compiled",
      name: blocked.name,
      primitive,
      shape,
      stages: stage(requests),
      rootBlockers: compiled.blockers,
      componentReasons: blocked.reasons,
      worldReasons,
      authoredFields: authored ? Object.keys(authored) : [],
      primitiveSource: authored?.primitive ?? null,
      shapeSource: authored?.SpawnShape ?? null,
      inputCases,
      nativeAcceptance: null,
      prospectiveOnly: true,
    });
  }
}
function summarize(map) {
  return [...map]
    .map(([dependency, value]) => ({
      dependency,
      requests: value.requestIds.size,
      components: value.componentIds.size,
      instanceComponents: value.instanceComponents,
      placementResolvedInstanceComponents:
        value.placementResolvedInstanceComponents,
      definitions: [...value.definitions].sort(),
      placementResolvedRequests: value.placementResolvedRequestIds.size,
      placementResolvedDefinitions: [
        ...value.placementResolvedDefinitions,
      ].sort(),
      additionalPlacementResolvedDefinitions: [
        ...value.placementResolvedDefinitions,
      ]
        .filter((id) => !generatedDefinitions.has(id))
        .sort(),
    }))
    .sort(
      (a, b) =>
        b.placementResolvedInstanceComponents -
          a.placementResolvedInstanceComponents || b.requests - a.requests,
    );
}
const primitiveGroups = new Map();
for (const c of componentCandidates) {
  if (c.alreadyCompiled || c.authoredDisabled) continue;
  if (!primitiveGroups.has(c.primitive))
    primitiveGroups.set(c.primitive, {
      componentIds: [],
      definitionIds: new Set(),
      requestIds: new Set(),
      instanceComponents: 0,
      placementResolvedInstanceComponents: 0,
    });
  const group = primitiveGroups.get(c.primitive);
  group.componentIds.push(`${c.definitionId}:${c.emitterId}`);
  group.definitionIds.add(c.definitionId);
  c.inputCases.forEach((r) => group.requestIds.add(r.sourceEventId));
  group.instanceComponents += c.stages.requests;
  group.placementResolvedInstanceComponents += c.stages.placementResolved;
}
const primitiveRanking = [...primitiveGroups]
  .map(([primitive, g]) => ({
    primitive,
    requests: g.requestIds.size,
    definitions: g.definitionIds.size,
    components: g.componentIds.length,
    instanceComponents: g.instanceComponents,
    placementResolvedInstanceComponents: g.placementResolvedInstanceComponents,
  }))
  .sort(
    (a, b) =>
      b.placementResolvedInstanceComponents -
      a.placementResolvedInstanceComponents,
  );
const singleDependencyGroups = new Map();
for (const c of componentCandidates.filter(
  (c) =>
    !c.alreadyCompiled &&
    !c.authoredDisabled &&
    c.rootBlockers.length === 0 &&
    c.componentReasons.length === 1,
))
  for (const row of byDefinition.get(c.definitionId))
    if (row.placementResolved)
      add(singleDependencyGroups, c.componentReasons[0], row, c.emitterId);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const result = {
  schema: 1,
  kind: "current-ordinary-effect-frontier-inventory",
  programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
  window: [69, 99],
  stages: stage(rows),
  resourceSelectedDefinitions: byDefinition.size,
  generatedDefinitions: [...generatedDefinitions].sort(),
  singleDependencyPlacementCandidates: summarize(singleDependencyGroups),
  primitiveRanking,
  sharedDependencies: summarize(dependencyGroups),
  compiledComponentFidelityDependencies: summarize(fidelityGroups),
  rootDependencies: summarize(rootGroups),
  components: componentCandidates,
  inputs,
  scope: {
    currentWorkerLedger: true,
    currentCompiledPrograms: true,
    actualRequests: true,
    capabilityCountsOverlap: true,
    placementResolvedDoesNotProveNewPrimitiveInputs: true,
    noEligibilityOrOwnershipInferred: true,
    runtimeInput: false,
    nativeAcceptance: null,
  },
};
const output = `${cache}/research/current-effect-frontier-v${DIRECT_EFFECT_PROGRAM_VERSION}.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    stages: result.stages,
    primitiveRanking,
    topDependencies: result.sharedDependencies.slice(0, 12).map((row) => ({
      dependency: row.dependency,
      placementResolvedRequests: row.placementResolvedRequests,
      placementResolvedInstanceComponents:
        row.placementResolvedInstanceComponents,
      additionalDefinitions: row.additionalPlacementResolvedDefinitions.length,
    })),
    inputs: Object.keys(inputs).length,
  }),
);
