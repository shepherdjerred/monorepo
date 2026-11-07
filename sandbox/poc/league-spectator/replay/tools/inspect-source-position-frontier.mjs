// Rank only. No source-matrix omission is admitted to normal playback here.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input drift: ${path}`);
  inputs[path] = digest;
  return data;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Ordinary diagnostic export required");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale ordinary export: ${path}`);
const { report } = exported,
  session = await read(`${cache}/research/direct-session-control.json`);
const descriptors = new Map(
  report.effectDescriptors.map((d) => [d.creationSequence, d]),
);
if (
  session.completeCoverage.rows.some(
    (row) => typeof row.placementResolved !== "boolean",
  )
)
  throw Error("Current separate placement stage required");
const candidates = session.completeCoverage.rows.filter(
  (row) =>
    row.origin === "network-effect" &&
    row.time >= 69 &&
    row.time <= 99 &&
    row.resourceResolved &&
    !row.placementResolved &&
    JSON.stringify(row.reasons.filter((r) => r.startsWith("world:"))) ===
      JSON.stringify(["world:source-transform-provider-matrix-required"]),
);
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes: await load("latest-effects/manifest.json"),
  effectIds: candidates.map((row) => row.definitionId),
});
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  height = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(height.buffer, height.byteOffset, height.byteLength / 4),
);
const world = createLatestWorldPresentation({ report, scene, terrain });
const rows = [];
for (const row of candidates) {
  const d = descriptors.get(row.entryOrder),
    definition = prepared.definitions.get(row.definitionId);
  if (
    !d ||
    d.entityId !== row.entityId ||
    d.transportSequence !== row.transportSequence ||
    d.time !== row.time
  )
    throw Error("Exact creation descriptor identity required");
  const reasons = [];
  if (
    !d.attachmentEntityId ||
    d.attachmentKey4c ||
    d.lookup14EntityId ||
    d.attachmentKey50 ||
    (d.lookupA8EntityId && d.lookupA8EntityId !== d.attachmentEntityId) ||
    d.byteFields.field98 ||
    d.field8c ||
    d.flags & ~0xb0 ||
    d.vector6c[1] !== 0
  )
    reasons.push("policy:source-key-zero-only-guards-not-met");
  const root = world.viewerRoot(d.attachmentEntityId, row.time, {
    transportSequence: row.transportSequence,
    entryOrder: row.entryOrder,
  });
  if (!root.resolved) reasons.push(...root.reasons);
  if (definition.blockers.length) reasons.push(...definition.blockers);
  const independent = definition.emitters
    .filter(
      (e) =>
        e.placementRequirements.rootBasis === false &&
        e.placementRequirements.boundObjectSize === null,
    )
    .map((e) => e.index);
  if (!independent.length) reasons.push("component:no-position-only-program");
  rows.push({
    sourceEventId: row.id,
    definitionId: row.definitionId,
    time: row.time,
    sourceEntityId: d.attachmentEntityId,
    flags: d.flags,
    independentEmitterIds: independent,
    componentOmissions: definition.emitters
      .filter((e) => !independent.includes(e.index))
      .map((e) => ({
        index: e.index,
        placementRequirements: e.placementRequirements,
      })),
    root,
    prospectiveOnly: true,
    reasons,
  });
}
const eligible = rows.filter((row) => !row.reasons.length),
  counts = {};
for (const row of eligible) {
  const d = (counts[row.definitionId] ??= {
    requests: 0,
    emitterIds: row.independentEmitterIds,
  });
  d.requests++;
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Final input drift: ${path}`);
const output = resolve(cache, "research/source-position-frontier-ranking.json");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-source-key-zero-position-only-frontier-ranking",
      comparisonWindow: [69, 99],
      candidates: rows.length,
      eligible: eligible.length,
      definitions: counts,
      rows,
      inputs,
      scope: {
        actualDecodedRequests: true,
        actualRuntimeActivationEstablished: false,
        sourceMatrixRecovered: false,
        nativeSourcePositionParityEstablished: false,
        eligibilityChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    candidates: rows.length,
    eligible: eligible.length,
    definitions: counts,
    inputs: Object.keys(inputs).length,
  }),
);
