import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  directEmitterLinkTimers,
  directParentSchedule,
  directEmitterStopDecision,
  directEmitterTailLifetimes,
  directEmitterEmissionGate,
  directEmitterTailCompletion,
  directParentCompletion,
  directParentCollection,
  compileDirectEmitterLifecycle,
  createDirectEmitterLifecycleState,
  beginDirectEmitterLifecycle,
  finishDirectEmitterLifecycle,
} from "../latest-direct-effect-lifecycle.mjs";
import { directRetirementFlags } from "../latest-direct-effect-retirement.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Lifecycle input drift");
  inputs[path] = hash;
  return bytes;
}
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Exact native image required");
function exact(actual, expected, label) {
  if (typeof actual === "number" && typeof expected === "number") {
    if (!Object.is(actual, expected))
      throw Error(`${label}: ${actual} != ${expected}`);
  } else if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(
      `${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
    );
}
async function evidence(report, nativeSourcesRelative = false) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    !report.inputs ||
    !Object.keys(report.inputs).length ||
    !report.sources ||
    !Object.keys(report.sources).length ||
    !Array.isArray(report.originalBlocks) ||
    !report.originalBlocks.length
  )
    throw Error("Exact original lifecycle evidence required");
  for (const [path, hash] of Object.entries(report.inputs))
    if ((await sha256(await raw(path))) !== hash)
      throw Error(`Native lifecycle input stale: ${path}`);
  for (const [path, hash] of Object.entries(report.sources))
    if (
      (await sha256(
        await raw(
          nativeSourcesRelative ? resolve(import.meta.dir, path) : path,
        ),
      )) !== hash
    )
      throw Error(`Native lifecycle producer stale: ${path}`);
  for (const block of report.originalBlocks)
    if (
      !Number.isSafeInteger(block.rva) ||
      !Number.isSafeInteger(block.size) ||
      block.size <= 0 ||
      block.rva < 0 ||
      block.rva + block.size > image.length ||
      (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
        block.sha256
    )
      throw Error("Original lifecycle instruction bytes differ");
}
const native = await json(`${cache}/research/direct-lifecycle-native.json`);
if (native.kind !== "native-direct-lifecycle-fragments")
  throw Error("Wrong lifecycle leaf cohort");
await evidence(native);
function matrix(rows, expected, key) {
  if (!Array.isArray(rows) || rows.length !== expected.size)
    throw Error("Complete lifecycle matrix required");
  const remaining = new Set(expected);
  for (const row of rows)
    if (!remaining.delete(JSON.stringify(key(row))))
      throw Error("Duplicate or unexpected lifecycle control");
  if (remaining.size) throw Error("Missing lifecycle control");
}
const set = (values) => new Set(values.map(JSON.stringify));
const scheduleKeys = [],
  timerKeys = [],
  stopKeys = [],
  tailKeys = [],
  completionKeys = [],
  parentKeys = [],
  emissionKeys = [];
for (const a of [0, 8, 64, 212])
  for (const p of [0, 4])
    for (const d of [0, 1 / 120, 1 / 30, 0.2, 1])
      for (const m of [1, 3, 20]) scheduleKeys.push([a, p, d, m]);
const MAX = Math.fround(3.4028234663852886e38);
exact(
  native.constructorDefaults,
  {
    particleLifetime: 3,
    lifetime: MAX,
    particleLinger: 0,
    emitterLinger: 0,
    delay: 0,
    activeTime: MAX,
    period: MAX,
    lingerType: 0,
    single: false,
  },
  "original typed lifecycle constructor defaults",
);
for (const l of [0, 0.5, 100])
  for (const t of [0, 0.75, MAX])
    for (const c of [0, 3, MAX]) timerKeys.push([l, t, c]);
for (const p of [0, 32, 0x8000, 0x8020])
  for (const a of [0, 2, 4, 6])
    for (const e of [0, 16])
      for (const n of [0, 1])
        for (const t of [0.5, 1, 2]) stopKeys.push([p, a, e, n, t]);
for (const k of [0, 1, 2, 3])
  for (const p of [0, 32])
    for (const s of [false, true])
      for (const t of [-1, 0.25])
        for (const c of [0, 0.75, MAX]) tailKeys.push([k, p, s, t, c]);
for (const f of [0, 1, 4, 5, 128, 255])
  for (const t of [0, 1, 1.5, 1.5000001192092896, 3])
    completionKeys.push([f, t]);
for (const p of [0, 2, 128, 130, 160, 162, 0x8000, 0xffff])
  for (const a of [0, 1, 4, 5, 128, 255]) parentKeys.push([p, a]);
for (const d of [-1, 0, 0.5])
  for (const t of [0, 0.5, 1, 1.25])
    for (const a of [0.5, MAX])
      for (const p of [1, MAX])
        for (const s of [false, true])
          for (const f of [0, 2]) emissionKeys.push([d, t, a, p, s, f]);
const matrices = [
  [
    native.schedule,
    set(scheduleKeys),
    (r) => [r.authoredFlags, r.parentInputFlags, r.delta, r.maxSubsteps],
  ],
  [native.timers, set(timerKeys), (r) => [r.lifetime, r.linger, r.lifetimeCap]],
  [
    native.stops,
    set(stopKeys),
    (r) => [
      r.parentFlags,
      r.actorFlags,
      r.emitterFlags,
      r.linkControllerCount,
      r.time,
    ],
  ],
  [
    native.tails,
    set(tailKeys),
    (r) => [
      r.lingerType,
      r.parentFlags,
      r.stopRequested,
      r.previousStopTime,
      r.cutoff,
    ],
  ],
  [native.completions, set(completionKeys), (r) => [r.actorFlags, r.time]],
  [
    native.parentCompletions,
    set(parentKeys),
    (r) => [r.parentFlags, r.complexFlags[0]],
  ],
  [
    native.emission,
    set(emissionKeys),
    (r) => [
      r.delay,
      r.time,
      r.activeTime,
      r.period,
      r.stopRequested,
      r.actorFlags,
    ],
  ],
];
let rejectedCorruptMatrices = 0;
for (const [rows, expected, key] of matrices) {
  matrix(rows, expected, key);
  for (const changed of [
    [],
    rows.slice(1),
    [rows[0], rows[0], ...rows.slice(2)],
  ]) {
    let rejected = false;
    try {
      matrix(changed, expected, key);
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Corrupt lifecycle matrix accepted");
    rejectedCorruptMatrices++;
  }
}
for (const row of native.schedule) {
  const actual = directParentSchedule({
    ...row,
    time: row.delta,
    clockOrigin: 0,
    timeOffset: 0,
    timeScale: 1,
    previousTime: 0,
  });
  exact(actual.count, row.count, "schedule count");
  exact(actual.step, row.step, "schedule step");
}
for (const row of native.timers)
  exact(
    directEmitterLinkTimers({
      particleLifetime: row.lifetime,
      lifetime: row.linger,
      particleLinger: row.lifetimeCap,
      emitterLinger: row.lingerCap,
    }),
    row.timers,
    "link timers",
  );
for (const row of native.stops) {
  const actual = directEmitterStopDecision(row);
  for (const key of Object.keys(actual))
    exact(actual[key], row[key], `stop ${key}`);
}
for (const row of native.tails) {
  const actual = directEmitterTailLifetimes(row);
  exact(actual.stopTime, row.stopTime, "tail first stop");
  exact(actual.after, row.after, "tail life");
}
for (const row of native.completions)
  exact(
    directEmitterTailCompletion(row.actorFlags, row.time, row.particles),
    row.flags,
    "tail completion",
  );
for (const row of native.parentCompletions)
  exact(
    directParentCompletion(row.parentFlags, row),
    row.flags,
    "parent completion",
  );
for (const row of native.emission) {
  const actual = directEmitterEmissionGate(row);
  exact(actual.emit, row.emit, "emission gate");
  exact(actual.resetLoopState, row.resetLoopState, "emission loop reset");
}

const schedules = await json(`${cache}/research/vfx-retirement-native.json`);
if (schedules.kind !== "native-system-retirement-observations")
  throw Error("Wrong original full-parent cohort");
await evidence(schedules, true);
const decoder = `${cache}/public/decoder-16.21-macos`;
const data = (hex) => new DataView(Uint8Array.fromHex(hex).buffer);
const uint = (hex, at) => data(hex).getUint16(at, true);
const fl = (hex, at) => data(hex).getFloat32(at, true);
const groups = new Map();
for (const row of schedules.cases) {
  const key = `${row.ref.effectId}:${row.ref.emitterIndex}`;
  if (!groups.has(key)) groups.set(key, new Set());
  if (groups.get(key).has(row.schedule))
    throw Error("Duplicate full-parent schedule");
  groups.get(key).add(row.schedule);
}
if (
  schedules.cases.length !== 18 ||
  groups.size !== 6 ||
  [...groups.values()].some(
    (s) =>
      s.size !== 3 ||
      !["running", "mode-false", "mode-true"].every((x) => s.has(x)),
  )
)
  throw Error("Six complete original full-parent schedule groups required");
let frames = 0,
  executed = 0,
  liveParticleDisposals = 0,
  deferredCases = 0;
for (const c of schedules.cases) {
  if (
    c.createdAt !== 0 ||
    c.seedHex !== "0000000000000001" ||
    c.quality !== 0 ||
    c.frames.length !== 181
  )
    throw Error("Exact original full-parent schedule required");
  const graphRaw = await raw(`${decoder}/${c.ref.file}`);
  if ((await sha256(graphRaw)) !== c.ref.sha256)
    throw Error("Original bound graph differs");
  const graph = JSON.parse(new TextDecoder().decode(graphRaw));
  let prior = c.initial,
    queued = false,
    deferred = false;
  exact(c.initial.flags, 0, "controlled constructor parent flags");
  for (let tick = 0; tick < 181; tick++) {
    const frame = c.frames[tick];
    exact(frame.input.time, tick / 30, "ordered native clock");
    frames++;
    if (frame.retirementRequested) {
      const transition = directRetirementFlags(
        prior.flags,
        c.schedule === "mode-true",
      );
      exact(transition.flags, frame.afterRequest.flags, "retirement request");
      queued ||= transition.enqueue;
    }
    if (frame.output) {
      if (deferred) throw Error("Disposed parent executed again");
      const b = prior.systemHex,
        previousTime = fl(b, 0x134);
      const actual = directParentSchedule({
        time: frame.input.time,
        clockOrigin: fl(b, 0x130),
        timeOffset: fl(b, 0x140),
        timeScale: fl(b, 0x13c),
        previousTime,
        frequency: fl(prior.managerHex, 0x280),
        authoredFlags: 212,
        parentInputFlags: uint(b, 0xf8),
        maxSubsteps: frame.input.maxSubsteps,
      });
      exact(actual.substeps, frame.output.substeps, "full parent substeps");
      exact(
        actual.nextTime,
        fl(frame.output.lifecycle.systemHex, 0x134),
        "full parent clock",
      );
      const actor = frame.output.state.actorHex;
      const time = fl(actor, 0x24),
        source = data(graph.assetObjectHex);
      const stop = directEmitterStopDecision({
        time,
        parentFlags: frame.afterRequest?.flags ?? prior.flags,
        lifetime: fl(actor, 0x20),
        stopTime: fl(c.initial.linkTimersHex, 4),
        actorFlags: prior.actorFlags,
        emitterFlags: source.getUint8(0x2d2),
        linkControllerCount: 0,
      });
      const life = frame.output.state.vectors.life,
        pairs = [];
      for (let i = 0; i < life.count; i++)
        pairs.push([fl(life.hex, i * 8), fl(life.hex, i * 8 + 4)]);
      const candidateFlags =
        (frame.output.lifecycle.actorFlags & 0xfe) |
        Number(stop.finishedCandidate);
      exact(
        directEmitterTailCompletion(candidateFlags, time, pairs),
        frame.output.lifecycle.actorFlags,
        "full native emitter completion",
      );
      const flags = directParentCompletion(frame.output.lifecycle.flags, {
        complexFlags: [frame.output.lifecycle.actorFlags],
        simpleComplete: [],
        meshComplete: [],
      });
      exact(flags, frame.output.lifecycle.flags, "full sibling completion");
      const shouldCollect = directParentCollection({
        parentFlags: flags,
        queued,
        managerForce: false,
        force: false,
      });
      const observed = frame.collected.lists.deferred.count === 1;
      exact(shouldCollect, observed, "original deferred collection");
      if (shouldCollect) {
        if (frame.output.state.vectors.life.count) liveParticleDisposals++;
        deferred = true;
        deferredCases++;
      }
      executed++;
    } else if (!deferred)
      throw Error("Unobserved native frame before disposal");
    prior = frame.collected;
  }
}
if (
  frames !== 3258 ||
  executed !== 2007 ||
  deferredCases !== 12 ||
  liveParticleDisposals !== 4
)
  throw Error("Original full-parent coverage differs");
const componentSchedules = await json(
  `${cache}/research/direct-lifecycle-schedule-native.json`,
);
if (componentSchedules.kind !== "native-direct-emitter-lifecycle-schedule")
  throw Error("Whole original emitter schedule required");
await evidence(componentSchedules);
const componentKeys = [];
for (const identity of [
  "champions/ornn/0/aec06c7c:0",
  "champions/ornn/0/b4161d97:7",
])
  for (const seed of ["0000000000000001", "0000000000012345"])
    for (const schedule of ["running", "mode-false", "mode-true"])
      componentKeys.push([identity, seed, schedule]);
matrix(componentSchedules.cases, set(componentKeys), (c) => [
  `${c.effectId}:${c.emitterIndex}`,
  c.seedHex,
  c.schedule,
]);
const manifest = await json(`${cache}/public/latest-effects/manifest.json`);
let componentFrames = 0,
  typedControllerSteps = 0,
  typedParticlePairs = 0,
  componentBirths = 0;
for (const c of componentSchedules.cases) {
  const ref = manifest.definitions[c.effectId],
    sourceRaw = await raw(`${cache}/public/latest-effects/${ref.file}`);
  if (
    (await sha256(sourceRaw)) !== ref.sha256 ||
    c.ref.sourceDefinitionSha256 !== ref.sha256
  )
    throw Error("Exact authored lifecycle component required");
  const source = JSON.parse(new TextDecoder().decode(sourceRaw)).definition
    .complexEmitterDefinitionData[c.emitterIndex];
  const program = compileDirectEmitterLifecycle(
    source,
    c.primitiveKind === "camera" ? "camera-quad" : "arbitrary-quad",
  );
  if (!program || c.frames.length !== 145)
    throw Error("Bounded full-emitter controller program required");
  let state = null;
  for (let tick = 0; tick < 145; tick++) {
    const frame = c.frames[tick];
    componentFrames++;
    exact(frame.input.time, tick / 60, "ordered canonical60 clock");
    if (!frame.output) continue;
    const entry = frame.trace.filter((v) => v.rva === 0x1757f10);
    if (entry.length !== 1)
      throw Error("Single original emitter entry required");
    const e = entry[0];
    if (!state) {
      state = createDirectEmitterLifecycleState(program, e.linkControllerCount);
      exact(
        state.actorFlags,
        data(e.actorHex).getUint8(0x18),
        "original initial actor flags",
      );
      exact(
        state.previousActorTime,
        fl(e.actorHex, 0x24),
        "original initial actor clock",
      );
      exact(
        state.stopTime,
        fl(e.actorHex, 0x10),
        "original initial stop clock",
      );
      exact(
        program.linkTimers,
        [fl(e.linkTimersHex, 0), fl(e.linkTimersHex, 4)],
        "compiled original link timers",
      );
    }
    exact(
      state.linkControllerCount,
      e.linkControllerCount,
      "original retained link controllers",
    );
    exact(
      state.actorFlags,
      data(e.actorHex).getUint8(0x18),
      "retained actor flags",
    );
    const decision = beginDirectEmitterLifecycle(program, state, {
      time: e.time,
      parentFlags: e.parentFlags,
    });
    if (decision.skip) throw Error("Unexpected duplicate emitter clock");
    const births = frame.output.state.births.length;
    if (!decision.emit && births)
      throw Error("Original emitted during translated emission suppression");
    componentBirths += births;
    const before = frame.trace.filter((v) => v.rva === 0x175b1e0),
      after = frame.trace.filter((v) => v.rva === 0x175b361);
    if (before.length > 1 || before.length !== after.length)
      throw Error("Original tail controller ownership differs");
    const count = before.length ? before[0].count : 0;
    const storage = new Float32Array(count * 20);
    if (before.length) {
      exact(
        decision.stopRequested,
        before[0].stopRequested,
        "original stop controller input",
      );
      for (let i = 0; i < count; i++) {
        storage[i * 20] = fl(before[0].particlesHex, i * 8);
        storage[i * 20 + 1] = fl(before[0].particlesHex, i * 8 + 4);
      }
    }
    const shifted = new Float32Array(storage),
      shiftedState = { ...state };
    for (let i = 0; i < count; i++) {
      shifted[i * 20 + 19] = shifted[i * 20];
      shifted[i * 20] = Math.fround(69 + shifted[i * 20]);
    }
    finishDirectEmitterLifecycle(program, state, {
      time: e.time,
      parentFlags: e.parentFlags,
      decision,
      emitted: births > 0,
      data: storage,
      count,
    });
    finishDirectEmitterLifecycle(program, shiftedState, {
      time: e.time,
      parentFlags: e.parentFlags,
      decision,
      emitted: births > 0,
      data: shifted,
      count,
      birthClockLane: 19,
    });
    exact(shiftedState, state, "separate actor-clock lane retained state");
    for (let i = 0; i < count; i++) {
      exact(
        shifted[i * 20 + 1],
        storage[i * 20 + 1],
        "separate actor-clock lane tail",
      );
      exact(
        shifted[i * 20],
        Math.fround(69 + storage[i * 20]),
        "absolute replay lane untouched",
      );
    }
    if (after.length) {
      exact(
        state.stopTime,
        fl(after[0].actorHex, 0x10),
        "original retained first stop clock",
      );
      for (let i = 0; i < count; i++) {
        exact(
          storage[i * 20],
          fl(after[0].particlesHex, i * 8),
          "typed retained particle birth",
        );
        exact(
          storage[i * 20 + 1],
          fl(after[0].particlesHex, i * 8 + 4),
          "typed rewritten particle lifetime",
        );
        typedParticlePairs++;
      }
    }
    exact(
      state.actorFlags,
      data(frame.output.state.actorHex).getUint8(0x18),
      "whole original emitter flags",
    );
    exact(
      state.previousActorTime,
      fl(frame.output.state.actorHex, 0x24),
      "whole original emitter clock",
    );
    typedControllerSteps++;
  }
}
if (
  componentFrames !== 1740 ||
  typedControllerSteps < 500 ||
  typedParticlePairs < 100 ||
  !componentBirths
)
  throw Error("Observable full-emitter lifecycle coverage required");
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-direct-effect-lifecycle.mjs"),
  resolve(import.meta.dir, "../latest-direct-effect-retirement.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(path);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final lifecycle input drift: ${path}`);
const output = `${cache}/research/direct-lifecycle-comparison.json`;
const counts = {
  schedulerControls: native.schedule.length,
  timerControls: native.timers.length,
  stopControls: native.stops.length,
  tailRewriteControls: native.tails.length,
  tailCompletionControls: native.completions.length,
  parentCompletionControls: native.parentCompletions.length,
  emissionControls: native.emission.length,
  frames,
  executed,
  deferredCases,
  liveParticleDisposals,
  rejectedCorruptMatrices,
  componentFrames,
  typedControllerSteps,
  typedParticlePairs,
  componentBirths,
};
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "direct-native-lifecycle-comparison",
      counts,
      inputs,
      scope: {
        originalParentScheduleExact: true,
        originalEmitterStopAndTailFragmentsExact: true,
        fullParentSchedulesConsumeNativeEmitterStates: true,
        fullEmitterSimulationCompared: false,
        movingMultiSubstepInterpolationTranslated: false,
        audioCleanupTranslated: false,
        originalDestructorExecuted: false,
        actualWorldAcceptanceRecovered: false,
        directRuntimeIntegrated: false,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ output, counts, pass: true }));
