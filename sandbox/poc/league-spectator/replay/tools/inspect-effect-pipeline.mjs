// Check native descriptor joins, prior-track preservation and the shared request
// timeline against an independent chronological fold. No renderer/factory claim.
import { resolve } from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-effect-pipeline.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {},
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  report = await read(`${cache}/research/latest-semantics-effects.json`),
  prior = await read(`${cache}/research/latest-semantics-combat-stats.json`),
  oracle = await read(`${cache}/research/effect-descriptor-comparison.json`),
  effectsManifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  quadGpuBytes = await raw(`${assets}/latest-complete-quad-gpu/package.json`),
  trailGpuBytes = await raw(`${assets}/latest-trail-particles/gpu.json`),
  options = { report, effectsManifestBytes, quadGpuBytes, trailGpuBytes };
let preservedFields = 0,
  descriptorFieldChecks = 0,
  snapshotChecks = 0,
  entityChecks = 0,
  rejectionChecks = 0;
let controlledChecks = 0;
for (const [key, value] of Object.entries(prior)) {
  if (key === "summary") {
    for (const [k, v] of Object.entries(value))
      check(equal(report.summary[k], v), `Prior count changed: ${k}`);
  } else {
    check(equal(report[key], value), `Prior replay track changed: ${key}`);
    preservedFields++;
  }
}
check(
  Array.isArray(oracle.mismatches) &&
    oracle.mismatches.length === 0 &&
    report.effectDescriptors.length === oracle.records.length,
  "Incomplete native descriptor oracle",
);
for (const [index, expected] of oracle.records.entries())
  for (const [key, value] of Object.entries(expected)) {
    check(
      equal(report.effectDescriptors[index][key], value),
      `Native descriptor differs: ${index}:${key}`,
    );
    descriptorFieldChecks++;
  }
const pipeline = await createLatestEffectPipeline(options);
function independent(time) {
  const map = new Map();
  for (const e of pipeline.events) {
    if (e.time > time) break;
    const old = map.get(e.entityId);
    if (e.kind === "create-request")
      map.set(e.entityId, {
        entityId: e.entityId,
        generation: (old?.generation ?? 0) + 1,
        creationSequence: e.creationSequence,
        phase: "creation-requested",
        requestedFlags: 0,
        removalCount: 0,
        lastRemovalSequence: null,
      });
    else
      map.set(e.entityId, {
        entityId: e.entityId,
        generation: old?.generation ?? 0,
        creationSequence: old?.creationSequence ?? null,
        phase:
          old?.creationSequence === undefined || old?.creationSequence === null
            ? "removal-without-observed-creation"
            : "removal-requested",
        requestedFlags:
          ((old?.requestedFlags ?? 0) | e.requestedFlagMask) >>> 0,
        removalCount: (old?.removalCount ?? 0) + 1,
        lastRemovalSequence: e.removalSequence,
      });
  }
  return [...map.values()].sort((a, b) => a.entityId - b.entityId);
}
const times = [
    ...new Set([
      0,
      report.endTime,
      ...pipeline.events.flatMap((e) => [
        Math.max(0, e.time - 0.0001),
        e.time,
        Math.min(report.endTime, e.time + 0.0001),
      ]),
    ]),
  ].sort((a, b) => a - b),
  chart = [];
for (const time of [...times, ...times.toReversed()]) {
  const snapshot = pipeline.snapshot(time),
    expected = independent(time);
  check(
    equal(snapshot.entities, expected),
    `Request timeline differs at ${time}`,
  );
  snapshotChecks++;
  const counts = {
    "creation-requested": 0,
    "removal-requested": 0,
    "removal-without-observed-creation": 0,
  };
  for (const s of expected) counts[s.phase]++;
  check(
    snapshot.counts.creationRequested === counts["creation-requested"] &&
      snapshot.counts.removalRequested === counts["removal-requested"] &&
      snapshot.counts.removalWithoutObservedCreation ===
        counts["removal-without-observed-creation"],
    "Timeline phase counts differ",
  );
}
for (let time = 0; time <= report.endTime; time++)
  chart.push(pipeline.seek(time));
for (const e of pipeline.events) {
  const sample = pipeline.sampleEntity(e.entityId, e.time);
  check(
    sample && sample.state.entityId === e.entityId,
    "Effect entity query failed",
  );
  entityChecks++;
}
async function rejects(fn) {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  check(threw, "Malformed effect pipeline input accepted");
  rejectionChecks++;
}
await rejects(() => pipeline.seek(-1));
await rejects(() => pipeline.seek(Infinity));
await rejects(() => pipeline.creation(-1));
await rejects(() => pipeline.sampleEntity(1.5, 0));
await rejects(() =>
  createLatestEffectPipeline({
    ...options,
    report: { ...report, protocol: "wrong" },
  }),
);
// Request ordering, ID reuse and removal-before-creation are not all exercised
// by this replay. Probe those policies explicitly without claiming native world
// registration semantics for the resulting request registry.
const controlled = structuredClone(report),
  id = 0x4000f000;
controlled.effectCreations = [0, 1].map((index) => ({
  ...structuredClone(report.effectCreations[0]),
  entityId: id,
  creationSequence: index,
  time: index + 1,
  transportSequence: index === 0 ? 20 : 40,
}));
controlled.effectDescriptors = controlled.effectCreations.map((c, index) => ({
  ...structuredClone(report.effectDescriptors[0]),
  entityId: id,
  creationSequence: index,
  time: c.time,
  transportSequence: c.transportSequence,
}));
controlled.effectRemovals = [
  [0.1, 10, 61],
  [2, 30, 61],
  [2, 50, 1],
].map(([time, transportSequence, reasonByte], index) => ({
  ...report.effectRemovals[0],
  entityId: id,
  time,
  transportSequence,
  reasonByte,
  removalSequence: index,
  requestedFlagMask: reasonByte === 61 ? 0x800 : 0x10000000,
}));
const controlledPipeline = await createLatestEffectPipeline({
  ...options,
  report: controlled,
});
for (const [time, generation, phase, flags, count] of [
  [0.1, 0, "removal-without-observed-creation", 0x800, 1],
  [1, 1, "creation-requested", 0, 0],
  [2, 2, "removal-requested", 0x10000000, 1],
  [1.5, 1, "creation-requested", 0, 0],
  [0.1, 0, "removal-without-observed-creation", 0x800, 1],
  [2, 2, "removal-requested", 0x10000000, 1],
]) {
  const state = controlledPipeline.sampleEntity(id, time).state;
  check(
    state.generation === generation &&
      state.phase === phase &&
      state.requestedFlags === flags &&
      state.removalCount === count,
    "Controlled effect request policy differs",
  );
  controlledChecks++;
}
await rejects(() =>
  createLatestEffectPipeline({ ...options, quadGpuBytes: new Uint8Array() }),
);
await rejects(() =>
  createLatestEffectPipeline({
    ...options,
    report: { ...report, effectDescriptors: [] },
  }),
);
const sources = {};
for (const name of [
  "latest-effect-pipeline.mjs",
  "latest-reconstruction.mjs",
  "latest-effect-descriptor.mjs",
  "latest-effect-creation.mjs",
  "latest-effect-placement.mjs",
  "latest-effect-removal.mjs",
  "structural-check-worker.mjs",
  "tools/inspect-latest-semantics.mjs",
  "tools/inspect-effect-pipeline.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "shared-effect-request-pipeline-comparison",
  build: report.build,
  protocol: report.protocol,
  inputs,
  sources,
  counts: {
    preservedFields,
    descriptorFieldChecks,
    snapshotChecks,
    entityChecks,
    rejectionChecks,
    controlledChecks,
    checkpoints: pipeline.checkpointCount,
    events: pipeline.events.length,
  },
  summary: pipeline.summary,
  chart,
  scope: {
    ...pipeline.scope,
    nativeDescriptorsCompared: true,
    priorTracksPreserved: true,
    forwardAndReverseQueriesCompared: true,
    browserRun: false,
  },
};
await Bun.write(
  `${cache}/research/effect-pipeline-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts: result.counts, summary: result.summary }));
