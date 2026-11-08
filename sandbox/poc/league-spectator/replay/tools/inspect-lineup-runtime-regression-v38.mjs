// Fresh selected-lineup runtime/GLES regression; old source pins remain historical.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Lineup regression input drift");
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const baseline = `${cache}/research/v38-regression-baseline`,
  index = await read(`${baseline}/exact-byte-index.json`);
for (const entry of index)
  assert.equal(
    await sha256(await raw(entry.path)),
    entry.sha256,
    "Exact historical readback baseline",
  );
const oldSession = await read(
    `${baseline}/direct-session-selected-control.json`,
  ),
  oldCapture = await read(
    `${baseline}/direct-session-selected-control-playback.json`,
  ),
  oldRaster = await read(
    `${baseline}/shared-direct-playback-offscreen-v37.json`,
  ),
  session = await read(
    `${cache}/research/direct-session-selected-control.json`,
  ),
  capture = await read(
    `${cache}/research/direct-session-selected-control-playback.json`,
  ),
  raster = await read(
    `${cache}/research/shared-direct-playback-offscreen-v38.json`,
  );
for (const report of [session, capture, raster])
  for (const [path, digest] of Object.entries(report.inputs))
    assert.equal(
      await sha256(await raw(path)),
      digest,
      `Current runtime/GLES prerequisite: ${path}`,
    );
assert.equal(session.summary.contract.runtimeVersion, 38);
assert.equal(
  session.summary.contract.replayHash,
  oldSession.summary.contract.replayHash,
);
assert.deepEqual(
  session.selectedStaticCatalog,
  oldSession.selectedStaticCatalog,
);
for (const field of ["events", "definitions"])
  assert.equal(session.summary[field], oldSession.summary[field]);
assert.equal(session.staticMaterials, oldSession.staticMaterials);
const prior = oldSession.diagnostic.targetedMissilePresentation.traces,
  now = session.diagnostic.targetedMissilePresentation.traces;
assert.equal(now.length, prior.length);
let initialVelocityChanges = 0,
  addedBasisTraces = 0,
  unchangedLaterStates = 0;
for (const a of now) {
  const b = prior.find((row) => row.instanceId === a.instanceId);
  assert(b, "No existing missile trace may disappear");
  assert.equal(a.policy, "native-rofl-retained-target-fixed-speed-partial-v2");
  if (a.effectBasisProgram && !b.effectBasisProgram) addedBasisTraces++;
  for (const field of [
    "entityId",
    "ownerId",
    "sourceEventId",
    "sequence",
    "startTime",
    "stopTime",
    "sourceStart",
    "emittedCastRequests",
    "targetSourceEventIds",
  ])
    assert.deepEqual(a[field], b[field], `Retained missile ${field}`);
  assert.equal(a.states.length, b.states.length);
  for (let i = 0; i < a.states.length; i++) {
    const left = structuredClone(a.states[i]),
      right = structuredClone(b.states[i]);
    delete left.effectBasis;
    if (i === 0) {
      if (JSON.stringify(left.velocity) !== JSON.stringify(right.velocity))
        initialVelocityChanges++;
      delete left.velocity;
      delete right.velocity;
    } else unchangedLaterStates++;
    assert.deepEqual(left, right, "Only constructor velocity/basis may change");
  }
}
assert.deepEqual(
  capture.snapshots,
  oldCapture.snapshots,
  "All 181 actual draw packets remain exact",
);
assert.equal(capture.snapshots.length, 181);
for (const [key, value] of Object.entries(capture.controls))
  assert.equal(value, true, `Retained-state control: ${key}`);
assert.deepEqual(raster.projection, oldRaster.projection);
assert.deepEqual(raster.viewport, oldRaster.viewport);
assert.deepEqual(raster.counts, oldRaster.counts);
assert.equal(raster.frames.length, oldRaster.frames.length);
let pixels = 0;
for (let i = 0; i < raster.frames.length; i++) {
  assert.equal(raster.frames[i].time, oldRaster.frames[i].time);
  assert.equal(
    raster.frames[i].rgbaSha256,
    oldRaster.frames[i].rgbaSha256,
    "Exact native GLES RGBA frame digest",
  );
  assert.equal(
    raster.frames[i].visiblePixels,
    oldRaster.frames[i].visiblePixels,
  );
  pixels += raster.frames[i].visiblePixels;
}
for (const [path, digest] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    digest,
    `Final lineup regression drift: ${path}`,
  );
const output = `${cache}/research/lineup-runtime-regression-v38.json`,
  report = {
    schema: 1,
    kind: "actual-selected-lineup-session-retained-state-gles-regression",
    artifactVersion: 38,
    inputs,
    comparison: {
      beforeRuntimeVersion: oldSession.summary.contract.runtimeVersion,
      afterRuntimeVersion: 38,
      targetedTraces: now.length,
      initialVelocityChanges,
      addedBasisTraces,
      unchangedLaterStates,
      exactDrawPacketFrames: capture.snapshots.length,
      exactGlesRgbaFrames: raster.frames.length,
      visiblePixelSamples: pixels,
    },
    counts: raster.counts,
    controls: capture.controls,
    mismatches: 0,
    scope: {
      currentActualSessionAndModuleWorker: true,
      freshNativeGlesReplay: true,
      identicalStaticCatalog: true,
      exactComparisonProjection: true,
      historicalInputsRelabeledCurrent: false,
      preparedOrSubmittedCountAsRendered: false,
      decodedCreatorCountInferredFromAssetFamily: false,
      fullNativeWorldParity: false,
      actualBrowserPerformanceMeasuredByThisControl: false,
    },
  };
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, ...report.comparison, mismatches: 0 }));
