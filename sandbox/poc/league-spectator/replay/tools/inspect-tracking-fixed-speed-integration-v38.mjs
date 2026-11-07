// Current ordinary-session integration against an immutable, previously
// source-current native oracle. Historical UI/session source pins stay historical.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Integration input drift");
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const base = `${cache}/research/v38-basis-preintegration`,
  index = await read(`${base}/exact-byte-index.json`);
for (const entry of index)
  assert.equal(
    await sha256(await raw(entry.path)),
    entry.sha256,
    "Immutable preintegration readback",
  );
const native = await read(`${base}/tracking-fixed-speed-basis-native-v38.json`),
  prior = await read(`${base}/direct-session-selected-control.json`),
  session = await read(
    `${cache}/research/direct-session-selected-control.json`,
  ),
  capture = await read(
    `${cache}/research/direct-session-selected-control-playback.json`,
  );
for (const report of [session, capture])
  for (const [path, digest] of Object.entries(report.inputs))
    assert.equal(
      await sha256(await raw(path)),
      digest,
      `Current session/capture input: ${path}`,
    );
assert.equal(session.summary.contract.runtimeVersion, 38);
assert.equal(session.summary.contract.replayHash, native.replaySha256);
assert.equal(native.build, session.summary.contract.build);
assert.equal(native.protocol, session.summary.contract.protocol);
// Original native producer, typed source and executable instructions remain
// exact. Its old UI/renderer/session closure is retained in the copied report,
// rather than relabeled current after the intended producer implementation.
for (const [path, digest] of Object.entries(native.inputs))
  if (
    /\.py$/.test(path) ||
    /[\\/]image\.bin$/.test(path) ||
    /[\\/]LeagueofLegends-macos$/.test(path) ||
    /[\\/]characters[\\/]akshan\.bin$/.test(path) ||
    /[\\/]hashes\.bin(fields|types)\.txt$/.test(path)
  )
    assert.equal(
      await sha256(await raw(path)),
      digest,
      `Original native algorithm/source input: ${path}`,
    );
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of native.blocks)
  assert.equal(
    await sha256(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const oldFamilies = prior.diagnostic.targetedMissilePresentation.traces,
  newFamilies = session.diagnostic.targetedMissilePresentation.traces,
  oldTraces = oldFamilies.filter(
    (row) =>
      row.policy === "native-rofl-retained-target-fixed-speed-partial-v1",
  ),
  newTraces = newFamilies.filter(
    (row) =>
      row.policy === "native-rofl-retained-target-fixed-speed-partial-v2",
  ),
  byId = new Map(newTraces.map((row) => [row.instanceId, row])),
  hex = (values) =>
    Buffer.from(Float32Array.from(values).buffer).toString("hex");
assert.equal(oldTraces.length, newTraces.length);
assert.deepEqual(
  newFamilies.filter(
    (row) =>
      row.policy !== "native-rofl-retained-target-fixed-speed-partial-v2",
  ),
  oldFamilies.filter(
    (row) =>
      row.policy !== "native-rofl-retained-target-fixed-speed-partial-v1",
  ),
  "Other movement families remain exact",
);
let initialVelocityChanges = 0,
  laterStates = 0,
  newBasisTraces = 0;
for (const old of oldTraces) {
  const now = byId.get(old.instanceId);
  assert(now, "Existing admitted motion identity cannot disappear");
  for (const key of [
    "sourceEventId",
    "entityId",
    "ownerId",
    "sequence",
    "startTime",
    "stopTime",
    "emittedCastRequests",
    "targetSourceEventIds",
    "sourceStart",
    "requestedTargetEntityId",
  ])
    assert.deepEqual(
      now[key],
      old[key],
      `Existing targeted presentation ${key}`,
    );
  assert.equal(
    now.policy,
    "native-rofl-retained-target-fixed-speed-partial-v2",
  );
  assert.equal(now.states.length, old.states.length);
  if (now.effectBasisProgram) newBasisTraces++;
  for (let i = 0; i < now.states.length; i++) {
    const a = structuredClone(now.states[i]),
      b = structuredClone(old.states[i]);
    delete a.effectBasis;
    if (i === 0) {
      if (hex(a.velocity) !== hex(b.velocity)) initialVelocityChanges++;
      delete a.velocity;
      delete b.velocity;
    } else laterStates++;
    assert.deepEqual(
      a,
      b,
      "Only native constructor velocity and verified basis are intended state deltas",
    );
  }
}
assert.equal(newBasisTraces, 4);
let nativeSamples = 0;
for (const expected of native.cases) {
  const trace = byId.get(expected.instanceId);
  assert.equal(trace.effectBasisProgram.movementType, "FixedSpeedMovement");
  assert.equal(trace.states.length, expected.samples.length);
  assert.equal(
    hex(trace.states[0].velocity),
    expected.initializer.originalInitializerVelocityHex,
  );
  for (let i = 0; i < trace.states.length; i++) {
    const a = trace.states[i],
      b = expected.samples[i],
      basis = b.matrix.filter((_, lane) => lane < 12 && lane % 4 !== 3);
    assert.equal(a.time, b.time);
    assert.equal(hex(a.position), hex(b.position));
    assert.equal(hex(a.velocity), hex(b.inputVelocity));
    assert.equal(a.stopped, b.stopped);
    assert.equal(
      hex(a.effectBasis),
      hex(basis),
      "Exact original creation/live/stopped basis bits",
    );
    nativeSamples++;
  }
}
const rows = session.completeCoverage.rows,
  selected = rows.filter(
    (row) =>
      row.origin === "missile" &&
      native.cases.some(
        (example) =>
          example.sourceEventId ===
          row.resourceEvidence?.motionEvidence?.sourceEventId,
      ),
  );
assert.equal(selected.length, 4);
for (const row of selected) {
  assert(
    row.placementResolved && row.worldInputsResolved && row.runtimeActivated,
  );
  assert.equal(row.compiledComponentCount, 3);
  assert.equal(row.eligibleComponentCount, 3);
  assert.equal(row.ownerId, native.cases[0].ownerId);
  assert.equal(
    row.ownershipStatus,
    "decoded-cast-owner-under-direct-missile-family-policy",
  );
  assert(
    row.reasons.includes(
      "emitter:4:material:native-constant-mult-pass0-default-atlas-subset",
    ),
  );
  assert(!row.reasons.includes("world:missile-root-basis-unrecovered"));
}
for (const omitted of native.excludedCandidates) {
  const row = rows.find(
    (row) => row.origin === "missile" && row.entityId === omitted.entityId,
  );
  assert.deepEqual(row.reasons, omitted.reasons);
  assert.equal(row.runtimeActivated, false);
}
const submitted = capture.snapshots.flatMap((frame) =>
  frame.draws.filter((draw) =>
    native.cases.some((example) =>
      selected.some(
        (row) =>
          row.entityId === example.entityId && row.id === draw.sourceEventId,
      ),
    ),
  ),
);
assert(submitted.every((draw) => [3, 6, 7].includes(draw.emitterId)));
for (const [path, digest] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    digest,
    `Final integration drift: ${path}`,
  );
const output = `${cache}/research/tracking-fixed-speed-integration-v38.json`,
  report = {
    schema: 1,
    kind: "actual-session-tracking-fixed-speed-initializer-basis-integration",
    artifactVersion: 38,
    inputs,
    targetedTraces: newTraces.length,
    initialVelocityChanges,
    unchangedLaterStates: laterStates,
    newBasisTraces,
    nativeSamples,
    nativeBasisLanes: nativeSamples * 9,
    activatedInstances: selected.length,
    eligibleComponents: selected.reduce(
      (n, row) => n + row.eligibleComponentCount,
      0,
    ),
    eligibleEmitterIds: [3, 6, 7],
    omittedEmitter4: "material:native-constant-mult-pass0-default-atlas-subset",
    excludedCandidates: native.excludedCandidates,
    submittedDrawRecords: submitted.length,
    submittedSourceEvents: [
      ...new Set(submitted.map((row) => row.sourceEventId)),
    ],
    mismatches: 0,
    scope: {
      currentActualOrdinarySessionAndModuleWorker: true,
      immutablePreintegrationNativeOracleReadback: true,
      originalNativeCodeAndTypedSourceStillExact: true,
      historicalUiClosureRelabeledCurrent: false,
      suppliedCausalRetainedTargetWorldProjection: true,
      nativeRegistryAcceptance: null,
      futureVelocitySubstitution: false,
      gpuContributingComponents: null,
      actualBrowserAcceptance: false,
    },
  };
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    targetedTraces: newTraces.length,
    initialVelocityChanges,
    laterStates,
    nativeSamples,
    activatedInstances: selected.length,
    eligibleComponents: report.eligibleComponents,
    submittedDrawRecords: submitted.length,
    mismatches: 0,
  }),
);
