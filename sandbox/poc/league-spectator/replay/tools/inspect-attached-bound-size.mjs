// Exact current source → actual placement → submitted/prefix-contributing
// component control. Historical raster inputs are kept historical, not repinned.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import {
  sampleLatestViewerResourceBoundSize,
  VIEWER_BOUND_SIZE_POLICY,
} from "../latest-viewer-bound-size.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  const digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Bound control input changed");
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
async function current(name) {
  const report = await read(`${cache}/research/${name}`);
  for (const [path, digest] of Object.entries(report.inputs ?? {}))
    assert.equal(
      await sha256(await raw(path)),
      digest,
      `Stale bound control prerequisite: ${path}`,
    );
  return report;
}
const native = await current("attached-bound-resource-native-v37.json"),
  session = await current("direct-session-selected-control.json"),
  capture = await current("direct-session-selected-control-playback.json"),
  raster = await current("shared-direct-playback-offscreen-v37.json"),
  historical = await read(
    `${cache}/research/shared-direct-playback-offscreen-v36.json`,
  ),
  report = await read(
    `${cache}/research/selected-ordinary-reconstruction.json`,
  );
assert.deepEqual(raster.projection, historical.projection);
assert.deepEqual(raster.viewport, historical.viewport);
assert.deepEqual(
  raster.frames.map((f) => f.time),
  historical.frames.map((f) => f.time),
);
const id = "champions/sona/75/c549d272",
  rows = session.completeCoverage.rows.filter(
    (r) => r.definitionId === id && r.time >= 69 && r.time <= 99,
  ),
  resolved = rows.filter((r) => r.worldInputsResolved),
  actors = new Map(native.actors.map((a) => [a.actorKey, a]));
const hex = (v) => Buffer.from(new Float32Array(v).buffer).toString("hex");
for (const row of rows) {
  assert.equal(row.ownerId, null);
  assert.equal(row.ownershipStatus, "network-creator-unresolved");
  const sequence = Number(row.id.split(":").at(-1)),
    creation = report.effectCreations[sequence];
  assert.equal(creation.creationSequence, sequence);
  assert.equal(creation.entityId, row.entityId);
  for (const field of [
    "resourceContextEntityId",
    "attachmentEntityId",
    "lookup14EntityId",
    "lookupA8EntityId",
  ])
    assert.equal(row.entityReferences[field], creation[field]);
  if (!row.worldInputsResolved) continue;
  const evidence = row.placementEvidence.boundObjectSizeEvidence,
    actor = actors.get(evidence.evidence.actorKey);
  assert.equal(evidence.policy, VIEWER_BOUND_SIZE_POLICY);
  assert.equal(evidence.entityId, creation.attachmentEntityId);
  assert.equal(evidence.time, row.time);
  assert.equal(evidence.cursor.transportSequence, row.transportSequence);
  assert.equal(evidence.cursor.entryOrder, row.entryOrder);
  const sampled = sampleLatestViewerResourceBoundSize(
    {
      resolved: true,
      resourceBounds: actor.resourceBounds,
      sphereRadius: actor.radius,
      modelScale: actor.suppliedViewerBounds[0].modelScale,
    },
    evidence.evidence.rootPosition,
  );
  assert.equal(
    hex([sampled.boundObjectSize]),
    hex([row.placementEvidence.boundObjectSize]),
  );
  assert.equal(hex(sampled.cachedAabb), hex(evidence.cachedAabb));
  for (const omission of evidence.omissions)
    assert(
      row.reasons.includes(omission),
      "Native-world omission must remain in ledger",
    );
}
const key = (d) =>
    JSON.stringify([
      d.sourceEventId,
      d.generation,
      d.definitionId,
      d.emitterId,
    ]),
  all = (r) =>
    r.frames.flatMap((f) => f.draws.map((d) => ({ ...d, time: f.time }))),
  oldPositive = new Map(
    all(historical)
      .filter((d) => d.prefixFramebufferChangedPixels > 0)
      .map((d) => [key(d), d]),
  ),
  positive = new Map(
    all(raster)
      .filter((d) => d.prefixFramebufferChangedPixels > 0)
      .map((d) => [key(d), d]),
  ),
  added = [...positive].filter(([k]) => !oldPositive.has(k)).map(([, d]) => d),
  removed = [...oldPositive]
    .filter(([k]) => !positive.has(k))
    .map(([, d]) => d);
assert.equal(removed.length, 0);
assert(added.every((d) => d.definitionId === id));
const target = all(raster).filter((d) => d.definitionId === id),
  summarize = (draws) => ({
    frames: new Set(draws.map((d) => d.time)).size,
    instances: new Set(
      draws.map((d) => JSON.stringify([d.sourceEventId, d.generation])),
    ).size,
    components: new Set(draws.map(key)).size,
  });
const output = {
  schema: 1,
  kind: "actual-attached-bound-size-resource-runtime-gpu-control",
  artifactVersion: 37,
  inputs,
  policy: VIEWER_BOUND_SIZE_POLICY,
  counts: {
    nativeTypedControls: native.controls.length,
    nativeRootControls: native.actors.reduce(
      (n, a) => n + (a.suppliedViewerBounds?.length ?? 0),
      0,
    ),
    nativeCurrentFlexControls: native.flexControls.length,
    requests: rows.length,
    placed: rows.filter((r) => r.placementResolved).length,
    worldReady: resolved.length,
    activated: resolved.filter((r) => r.runtimeActivated).length,
    eligibleComponents: resolved.reduce(
      (n, r) => n + r.eligibleComponentCount,
      0,
    ),
    submitted: summarize(target),
    prefixContributing: summarize(
      target.filter((d) => d.prefixFramebufferChangedPixels > 0),
    ),
    addedPositiveComponents: added.length,
    removedPositiveComponents: removed.length,
  },
  omittedRequests: rows
    .filter((r) => !r.worldInputsResolved)
    .map((r) => ({ id: r.id, generation: r.generation, reasons: r.reasons })),
  addedPositiveIdentities: added.map(
    ({
      sourceEventId,
      generation,
      definitionId,
      emitterId,
      ownerId,
      ownershipStatus,
    }) => ({
      sourceEventId,
      generation,
      definitionId,
      emitterId,
      ownerId,
      ownershipStatus,
    }),
  ),
  controls: capture.controls,
  scope: {
    sameHistoricalProjectionViewportAndClock: true,
    historicalRasterNotRepinned: true,
    allFourReferencesPreserved: true,
    causalOwnedViewerModelProjection: true,
    nativeLiveModelParityEstablished: false,
    creatorIdentityEstablished: false,
    offscreenActualGpuContributions: true,
    browserExecuted: false,
  },
};
await Bun.write(
  `${cache}/research/attached-bound-size-control-v37.json`,
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output.counts));
