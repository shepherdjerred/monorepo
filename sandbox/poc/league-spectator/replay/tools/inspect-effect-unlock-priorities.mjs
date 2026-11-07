// Recorded-request capability inventory under the declared initial resource
// presentation policy. Counts are prerequisites/candidates, never raster proof.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import { createLatestViewerRootAttachmentPlacement } from "../latest-viewer-root-attachment.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { directComponentWorldInputOmissions } from "../latest-direct-effect-world-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input changed: ${path}`);
  inputs[path] = hash;
  return bytes;
}
async function read(path) {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)),
  );
}
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Ordinary decoded diagnostic export required");
for (const [path, hash] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Stale reconstruction input: ${path}`);
if (
  (await sha256(await raw(exported.controlReportPath))) !==
  exported.controlReportSha256
)
  throw Error("Ordinary reconstruction proof changed");
const report = exported.report,
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const manifestBytes = await load("latest-effects/manifest.json");
const initial = await loadLatestInitialResourcePrefix({
  profile,
  load,
  manifestBytes,
  report,
});
const unitResources = await createLatestUnitResources({
  profile,
  resolvers: initial.resolvers,
  packageBytes: await load("latest-unit-resources/package.json"),
});
const requests = [],
  statuses = {},
  ids = new Set();
for (const [entryOrder, descriptor] of report.effectDescriptors.entries()) {
  if (descriptor.time < 69 || descriptor.time > 99) continue;
  const cursor = {
    transportSequence: descriptor.transportSequence,
    entryOrder,
  };
  const sourceEventId = `effect-create:${descriptor.transportSequence}:${entryOrder}:${descriptor.entityId}`;
  const units = [],
    evidence = [];
  let selection;
  if (descriptor.field8c !== 0)
    selection = { status: "nonordinary-factory-order" };
  else {
    for (const field of ["resourceContextEntityId", "lookupA8EntityId"]) {
      const entityId = descriptor[field];
      if (!Number.isInteger(entityId) || entityId < 0 || entityId > 0xffffffff)
        throw Error("Unsigned recorded resource entity required");
      if (!entityId) continue;
      const result = initial.policy.query(entityId, descriptor.time, cursor);
      evidence.push({ field, entityId, ...result });
      units.push(
        result.stack ?? { status: "unresolved-unit-resource-stack", entityId },
      );
    }
    selection = unitResources.selectSuppliedStacks(
      {
        units,
        auxiliaries: descriptor.unresolvedAuxiliaryContextIds.map(
          (contextIdentity) => ({
            id: `auxiliary:${contextIdentity}`,
            contextIdentity,
          }),
        ),
      },
      descriptor.resourceKey,
    );
  }
  statuses[selection.status] = (statuses[selection.status] ?? 0) + 1;
  const definitionId =
    selection.status === "matched-authored-reference" &&
    selection.resource?.status === "prepared-definition"
      ? selection.resource.effectId
      : null;
  if (definitionId) ids.add(definitionId);
  requests.push({
    sourceEventId,
    descriptor,
    cursor,
    selection,
    definitionId,
    resourceEvidence: evidence,
  });
}
if (requests.length !== 1110)
  throw Error(
    "Complete actual comparison sequence requires1110 decoded creations",
  );
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: [...ids],
});
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  heights = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(heights.buffer, heights.byteOffset, heights.byteLength / 4),
);
const placement = createLatestViewerRootAttachmentPlacement({
  profile,
  packetPlacement: await createLatestDirectEffectPlacement({
    profile,
    packageBytes: prepared.packages.placement,
  }),
  definitions: prepared.definitions,
});
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  placementResolver: placement.resolve,
});
const rank = new Map(),
  rootRank = new Map(),
  frontiers = new Map(),
  worldRank = new Map(),
  worldRootRank = new Map(),
  worldFrontiers = new Map(),
  definitions = [],
  candidates = [];
const add = (map, reason, definition, rows, sole) => {
  const value = map.get(reason) ?? {
    reason,
    requests: new Set(),
    definitions: new Set(),
    components: new Set(),
    weightedComponentInstances: 0,
    soleReasonComponentInstances: 0,
  };
  rows.forEach((row) => value.requests.add(row.sourceEventId));
  value.definitions.add(definition.id);
  value.weightedComponentInstances += rows.length;
  value.soleReasonComponentInstances += sole ? rows.length : 0;
  map.set(reason, value);
  return value;
};
for (const definition of prepared.definitions.values()) {
  const rows = requests.filter((row) => row.definitionId === definition.id);
  const placementRows = [];
  const supported = new Set(definition.emitters.map((e) => e.index));
  const omitted = new Map();
  for (const component of definition.unsupported) {
    if (supported.has(component.index)) continue;
    const reasons = omitted.get(component.index) ?? new Set();
    component.reasons.forEach((reason) => reasons.add(reason));
    omitted.set(component.index, reasons);
  }
  for (const reason of definition.blockers)
    add(rootRank, reason, definition, rows, definition.blockers.length === 1);
  for (const [index, reasons] of omitted)
    for (const reason of reasons) {
      const value = add(
        rank,
        reason,
        definition,
        rows,
        reasons.size === 1 && !definition.blockers.length,
      );
      value.components.add(`${definition.id}:${index}`);
    }
  if (!definition.blockers.length)
    for (const [index, reasons] of omitted) {
      const key = [...reasons].sort().join("|"),
        frontier = frontiers.get(key) ?? {
          reasons: [...reasons].sort(),
          components: [],
          requests: new Set(),
          weightedComponentInstances: 0,
        };
      frontier.components.push({
        definitionId: definition.id,
        emitterIndex: index,
      });
      rows.forEach((row) => frontier.requests.add(row.sourceEventId));
      frontier.weightedComponentInstances += rows.length;
      frontiers.set(key, frontier);
    }
  for (const row of rows) {
    const result = world.placement(
      { descriptor: row.descriptor, definitionId: definition.id },
      row.descriptor.time,
      row.cursor,
    );
    placementRows.push({
      sourceEventId: row.sourceEventId,
      time: row.descriptor.time,
      entityId: row.descriptor.entityId,
      placementResolved: result.resolved,
      policy: result.policy ?? null,
      position: result.position ?? null,
      basis: result.basis ?? null,
      rootInput: result.rootInput ?? null,
      boundObjectSize: result.boundObjectSize ?? null,
      boundObjectSizeStatus: result.boundObjectSizeStatus ?? null,
      reasons: result.reasons,
    });
    const eligibleComponents = result.resolved
      ? definition.emitters.filter(
          (emitter) =>
            !directComponentWorldInputOmissions(emitter, result).length,
        )
      : [];
    Object.assign(placementRows.at(-1), {
      compiledComponentCount: definition.emitters.length,
      eligibleComponentCount: eligibleComponents.length,
      worldInputsResolved: result.resolved && eligibleComponents.length > 0,
      allCompiledComponentInputsResolved:
        result.resolved &&
        definition.emitters.length > 0 &&
        eligibleComponents.length === definition.emitters.length,
    });
    if (
      !definition.blockers.length &&
      eligibleComponents.length &&
      result.resolved
    )
      candidates.push({
        sourceEventId: row.sourceEventId,
        time: row.descriptor.time,
        entityId: row.descriptor.entityId,
        definitionId: definition.id,
        componentIds: eligibleComponents.map((e) => e.index),
        resourceEvidence: row.resourceEvidence,
        selection: row.selection,
        placementPolicy: result.policy ?? null,
        placementReasons: result.reasons,
      });
  }
  const resolvedIds = new Set(
    placementRows
      .filter((row) => row.placementResolved)
      .map((row) => row.sourceEventId),
  );
  const resolvedRows = rows.filter((row) => resolvedIds.has(row.sourceEventId));
  if (resolvedRows.length)
    for (const reason of definition.blockers)
      add(
        worldRootRank,
        reason,
        definition,
        resolvedRows,
        definition.blockers.length === 1,
      );
  if (!definition.blockers.length && resolvedRows.length)
    for (const [index, reasons] of omitted) {
      if (reasons.has("authored-disabled")) continue;
      for (const reason of reasons) {
        const value = add(
          worldRank,
          reason,
          definition,
          resolvedRows,
          reasons.size === 1,
        );
        value.components.add(`${definition.id}:${index}`);
      }
      const key = [...reasons].sort().join("|"),
        frontier = worldFrontiers.get(key) ?? {
          reasons: [...reasons].sort(),
          components: [],
          requests: new Set(),
          weightedComponentInstances: 0,
        };
      frontier.components.push({
        definitionId: definition.id,
        emitterIndex: index,
      });
      resolvedRows.forEach((row) => frontier.requests.add(row.sourceEventId));
      frontier.weightedComponentInstances += resolvedRows.length;
      worldFrontiers.set(key, frontier);
    }
  definitions.push({
    id: definition.id,
    recordedRequests: rows.length,
    admittedComponents: definition.emitters.map((e) => e.index),
    rootBlockers: definition.blockers,
    placementResolvedRequests: placementRows.filter(
      (row) => row.placementResolved,
    ).length,
    worldInputsResolvedRequests: placementRows.filter(
      (row) => row.worldInputsResolved,
    ).length,
    allCompiledComponentInputsResolvedRequests: placementRows.filter(
      (row) => row.allCompiledComponentInputsResolved,
    ).length,
    worldInputQueries: placementRows,
    omittedComponents: [...omitted].map(([index, reasons]) => ({
      index,
      reasons: [...reasons],
    })),
  });
}
const ranked = (map) =>
  [...map.values()]
    .map((row) => ({
      reason: row.reason,
      affectedRequests: row.requests.size,
      distinctDefinitions: row.definitions.size,
      omittedComponents: row.components.size,
      weightedComponentInstances: row.weightedComponentInstances,
      soleReasonComponentInstances: row.soleReasonComponentInstances,
    }))
    .sort(
      (a, b) =>
        b.affectedRequests - a.affectedRequests ||
        b.soleReasonComponentInstances - a.soleReasonComponentInstances,
    );
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Input drift: ${path}`);
const output = `${cache}/research/effect-unlock-priorities.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-request-shared-capability-priorities",
      comparisonWindow: [69, 99],
      decodedCreationRequests: requests.length,
      inputs,
      resourcePolicy: initial.policy.metadata.policy,
      resourceSelectionStatuses: statuses,
      resourceSelectedRequests: requests.filter((r) => r.definitionId).length,
      distinctSelectedDefinitions: ids.size,
      worldPlacedCurrentCandidates: candidates,
      componentReasons: ranked(rank),
      rootReasons: ranked(rootRank),
      rootClearComponentFrontiers: [...frontiers.values()]
        .map((row) => ({
          reasons: row.reasons,
          affectedRequests: row.requests.size,
          weightedComponentInstances: row.weightedComponentInstances,
          components: row.components,
        }))
        .sort(
          (a, b) =>
            a.reasons.length - b.reasons.length ||
            b.affectedRequests - a.affectedRequests,
        ),
      worldPlacedRootClearComponentReasons: ranked(worldRank),
      worldPlacedRootReasons: ranked(worldRootRank),
      worldPlacedRootClearComponentFrontiers: [...worldFrontiers.values()]
        .map((row) => ({
          reasons: row.reasons,
          affectedRequests: row.requests.size,
          weightedComponentInstances: row.weightedComponentInstances,
          components: row.components,
        }))
        .filter((row) => row.affectedRequests > 0)
        .sort(
          (a, b) =>
            a.reasons.length - b.reasons.length ||
            b.affectedRequests - a.affectedRequests,
        ),
      definitions,
      scope: {
        actualDecodedRequests: true,
        declaredPresentationResourcePolicy: true,
        nativeWorldAcceptance: null,
        nativeResourceReadiness: null,
        candidateCountsAreNotRuntimeActivation: true,
        unknownFutureComponentWorldRequirementsRecovered: false,
        worldPlacedCountsArePlacementPreconditionsOnly: true,
        rasterSubmissionEstablished: false,
        renderedCoverage: false,
        actualBrowserPlayback: false,
        runtimePlaybackInput: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    decodedRequests: requests.length,
    resourceSelectionStatuses: statuses,
    selectedRequests: requests.filter((r) => r.definitionId).length,
    distinctDefinitions: ids.size,
    worldPlacedCandidates: candidates.length,
    topComponentReasons: ranked(rank).slice(0, 12),
    topWorldPlacedRootClearReasons: ranked(worldRank)
      .filter((r) => r.affectedRequests > 0)
      .slice(0, 12),
    worldPlacedRootReasons: ranked(worldRootRank),
    rootReasons: ranked(rootRank),
    inputFingerprintsVerified: Object.keys(inputs).length,
  }),
);
