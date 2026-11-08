// 16.21.829.8620 original parent/emitter lifecycle fragments. These functions
// consume resolved runtime fields, never infer them from authored system flags.
import { compileDirectValueFloatMaximum } from "./latest-direct-effect-value-maximum.mjs";
const f = Math.fround;
export const DIRECT_LIFECYCLE_MAX_FLOAT = f(3.4028234663852886e38);
const uint = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const finite = (v) => Number.isFinite(v) && Number.isFinite(f(v));
function floats(values) {
  if (!values.every(finite))
    throw Error("Explicit finite lifecycle clocks required");
}
const pairs = (value) =>
  Array.isArray(value) &&
  Array.from({ length: value.length }, (_, i) => i).every(
    (i) =>
      Object.hasOwn(value, i) &&
      Array.isArray(value[i]) &&
      value[i].length === 2 &&
      [0, 1].every((j) => Object.hasOwn(value[i], j) && finite(value[i][j])),
  );
const dense = (value) =>
  Array.isArray(value) &&
  Array.from({ length: value.length }, (_, i) => i).every((i) =>
    Object.hasOwn(value, i),
  );

// Definition defaults are from original16ffef0. A resource maximum is a
// postload/getter result, not an estimate of the random sampler's upper bound.
function lifecycleInputs(source, primitive) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    return { reasons: ["lifecycle:emitter-source-unresolved"] };
  if (!["camera-quad", "arbitrary-quad"].includes(primitive))
    return {
      reasons: [`lifecycle:primitive-controller-untranslated:${primitive}`],
    };
  const particleLifetimeResource = compileDirectValueFloatMaximum(
    source.particleLifetime,
  );
  const reasons = [];
  if (!particleLifetimeResource)
    reasons.push("lifecycle:particle-lifetime-resource-maximum-untranslated");
  else if (!(particleLifetimeResource.maximum > 0))
    reasons.push("lifecycle:nonpositive-particle-lifetime-resource-maximum");
  const optional = (key, fallback) =>
    Object.hasOwn(source, key) ? source[key] : fallback;
  const lifetime = optional("lifetime", DIRECT_LIFECYCLE_MAX_FLOAT);
  const particleLinger = optional("particleLinger", 0),
    emitterLinger = optional("emitterLinger", 0);
  const lingerType = optional("particleLingerType", 0),
    delay = optional("timeBeforeFirstEmission", 0);
  const single = optional("isSingleParticle", false);
  for (const [key, value, positive] of [
    ["lifetime", lifetime, true],
    ["particleLinger", particleLinger, false],
    ["emitterLinger", emitterLinger, false],
    ["timeBeforeFirstEmission", delay, false],
  ])
    if (!finite(value) || (positive ? !(f(value) > 0) : f(value) < 0))
      reasons.push(`lifecycle:unsupported-input:${key}`);
  if (![0, 1, 2].includes(lingerType))
    reasons.push("lifecycle:particle-linger-type-untranslated");
  if (![false, true, 0, 1].includes(single))
    reasons.push("lifecycle:single-particle-flag-untranslated");
  if (Object.hasOwn(source, "period"))
    reasons.push("lifecycle:periodic-controller-untranslated");
  return {
    particleLifetimeResource,
    lifetime,
    particleLinger,
    emitterLinger,
    lingerType,
    delay,
    single,
    reasons,
  };
}

export function directEmitterLifecycleOmissions(source, primitive) {
  return lifecycleInputs(source, primitive).reasons;
}

export function compileDirectEmitterLifecycle(source, primitive) {
  const input = lifecycleInputs(source, primitive);
  if (input.reasons.length) return null;
  const {
    particleLifetimeResource,
    lifetime,
    particleLinger,
    emitterLinger,
    lingerType,
    delay,
    single,
  } = input;
  return {
    schema: 1,
    particleLifetime: particleLifetimeResource.maximum,
    particleLifetimeResource,
    lifetime: f(lifetime),
    particleLinger: f(particleLinger),
    emitterLinger: f(emitterLinger),
    lingerType,
    delay: f(delay),
    activeTime: DIRECT_LIFECYCLE_MAX_FLOAT,
    period: DIRECT_LIFECYCLE_MAX_FLOAT,
    emitterFlags: single ? 0x10 : 0,
    requiresLinkControllerCount: !!single,
    linkTimers: directEmitterLinkTimers({
      particleLifetime: particleLifetimeResource.maximum,
      lifetime,
      particleLinger,
      emitterLinger,
    }),
  };
}

export function createDirectEmitterLifecycleState(
  program,
  linkControllerCount,
) {
  if (
    !program ||
    program.schema !== 1 ||
    typeof program.requiresLinkControllerCount !== "boolean" ||
    (program.requiresLinkControllerCount &&
      !uint(linkControllerCount, 0xffffffff)) ||
    (!program.requiresLinkControllerCount &&
      linkControllerCount !== null &&
      !uint(linkControllerCount, 0xffffffff))
  )
    throw Error(
      "Verified emitter program and explicit link-controller count required",
    );
  return {
    actorFlags: 0,
    previousActorTime: -DIRECT_LIFECYCLE_MAX_FLOAT,
    stopTime: -1,
    linkControllerCount,
  };
}

// Call BEFORE the existing expired-particle prune and emission/birth kernels.
// The caller retains all existing RNG/geometry/particle allocation ownership.
export function beginDirectEmitterLifecycle(
  program,
  state,
  { time, parentFlags },
) {
  floats([time, state.previousActorTime, state.stopTime]);
  if (
    !uint(state.actorFlags, 0xff) ||
    !uint(parentFlags, 0xffff) ||
    f(time) < state.previousActorTime
  )
    throw Error("Monotonic retained emitter lifecycle state required");
  if (f(time) === state.previousActorTime)
    return { skip: true, emit: false, resetLoopState: false };
  const decision = directEmitterStopDecision({
    time,
    parentFlags,
    lifetime: program.lifetime,
    stopTime: program.linkTimers[1],
    actorFlags: state.actorFlags,
    emitterFlags: program.emitterFlags,
    linkControllerCount: program.requiresLinkControllerCount
      ? state.linkControllerCount
      : 0,
  });
  const gate = decision.singleEmissionBypassed
    ? { emit: false, resetLoopState: false }
    : directEmitterEmissionGate({
        time,
        lifetime: program.lifetime,
        delay: program.delay,
        activeTime: program.activeTime,
        period: program.period,
        stopRequested: decision.stopRequested,
        actorFlags: state.actorFlags,
      });
  return { skip: false, ...decision, ...gate };
}

function typedParticles(data, count, stride) {
  if (
    !(data instanceof Float32Array) ||
    !uint(count, 0xffff) ||
    !uint(stride, 0xffff) ||
    stride < 2 ||
    count * stride > data.length
  )
    throw Error("Owned Float32 particle life storage required");
}

// Call AFTER admitted births and BEFORE particle curve/position updates. Data
// uses existing runtime stride20 [birthClock,lifetime,...]. No allocation, RNG,
// movement, birth, or GPU buffer is performed here.
export function finishDirectEmitterLifecycle(
  program,
  state,
  {
    time,
    parentFlags,
    decision,
    emitted,
    data,
    count,
    stride = 20,
    birthClockLane = 0,
  },
) {
  floats([time]);
  typedParticles(data, count, stride);
  if (
    !decision ||
    decision.skip ||
    typeof emitted !== "boolean" ||
    !uint(parentFlags, 0xffff) ||
    typeof decision.finishedCandidate !== "boolean" ||
    typeof decision.stopRequested !== "boolean" ||
    !uint(birthClockLane, stride - 1) ||
    birthClockLane === 1
  )
    throw Error("Ordered emitter lifecycle decision required");
  if (emitted) state.actorFlags |= 4;
  state.actorFlags =
    (state.actorFlags & 0xfe) | Number(decision.finishedCandidate);
  if (
    count &&
    (program.lingerType === 2 || parentFlags & 0x20) &&
    decision.stopRequested
  ) {
    const initial =
      state.stopTime >= f(-1.0000009536743164) &&
      state.stopTime <= f(-0.9999989867210388);
    if (initial) state.stopTime = f(time);
    if ((program.lingerType === 1 || program.lingerType === 2) && initial)
      for (let i = 0; i < count; i++)
        data[i * stride + 1] = f(
          f(f(time) - data[i * stride + birthClockLane]) +
            program.linkTimers[0],
        );
    else if (program.lingerType === 0)
      for (let i = 0; i < count; i++)
        if (data[i * stride + 1] > program.linkTimers[0])
          data[i * stride + 1] = program.linkTimers[0];
  }
  if (state.actorFlags & 1)
    for (let i = 0; i < count; i++)
      if (
        !(f(f(time) - data[i * stride + birthClockLane]) > data[i * stride + 1])
      ) {
        state.actorFlags &= 0xfe;
        break;
      }
  state.previousActorTime = f(time);
  return !!(state.actorFlags & 1);
}

// Original 16e1742..16e17e6. particleLifetime is the original curve resource
// virtual+30 result when one exists, otherwise its inline constant. The caller
// must resolve that resource; this kernel supplies no guessed curve maximum.
export function directEmitterLinkTimers({
  particleLifetime,
  lifetime,
  particleLinger,
  emitterLinger,
}) {
  floats([particleLifetime, lifetime, particleLinger, emitterLinger]);
  const particleLimit = f(f(particleLifetime) + f(10));
  const emitterLimit =
    f(lifetime) === DIRECT_LIFECYCLE_MAX_FLOAT
      ? DIRECT_LIFECYCLE_MAX_FLOAT
      : f(f(lifetime) + f(10));
  return [
    Math.min(
      particleLimit,
      f(particleLinger) === DIRECT_LIFECYCLE_MAX_FLOAT
        ? particleLimit
        : f(particleLinger),
    ),
    Math.min(
      emitterLimit,
      f(emitterLinger) === DIRECT_LIFECYCLE_MAX_FLOAT
        ? emitterLimit
        : f(emitterLinger),
    ),
  ];
}

// Original 1763237..1763391. Return raw parent substeps; moving multi-step
// emitter interpolation and its per-emitter first-step clamp remain separate.
export function directParentSchedule({
  time,
  clockOrigin,
  timeOffset,
  timeScale,
  previousTime,
  frequency,
  authoredFlags,
  parentInputFlags,
  maxSubsteps,
}) {
  floats([time, clockOrigin, timeOffset, timeScale, previousTime, frequency]);
  if (
    !(f(timeScale) > 0) ||
    !(f(frequency) > 0) ||
    !uint(authoredFlags, 0xffff) ||
    !uint(parentInputFlags, 0xffffffff) ||
    !uint(maxSubsteps, 20) ||
    !maxSubsteps
  )
    throw Error("Explicit typed parent scheduler inputs required");
  const elapsed = f(f(time) - f(clockOrigin));
  const target = f(f(f(timeOffset) / f(timeScale)) + elapsed);
  const delta = f(target - f(previousTime));
  if (delta < 0 || !finite(delta))
    throw Error("Monotonic parent clock required");
  let count = 1,
    step;
  if (authoredFlags & 8 || parentInputFlags & 4) step = delta;
  else {
    step = f(f(1) / f(frequency));
    const product = f(f(frequency) * delta);
    if (product > 0x7fffffff)
      throw Error("Parent scheduler integer range exceeded");
    count = Math.trunc(product);
    if (!count && authoredFlags & 64) {
      count = 1;
      step = delta;
    }
  }
  if (count > maxSubsteps) {
    let reduced = f(count);
    while (reduced > f(maxSubsteps)) {
      reduced = f(reduced * f(0.5));
      step = f(step + step);
    }
    count = Math.trunc(reduced);
  }
  const substeps = [];
  let nextTime = f(previousTime);
  for (let i = 0; i < count; i++) {
    nextTime = f(nextTime + step);
    substeps.push(nextTime);
  }
  return { delta, count, step, substeps, nextTime };
}

// Original 17584c4..175853d. EmitterFlags is definition byte+2d2,
// actorFlags is actor byte+18, and stopTime is link float+94.
export function directEmitterStopDecision({
  time,
  parentFlags,
  lifetime,
  stopTime,
  actorFlags,
  emitterFlags,
  linkControllerCount,
}) {
  floats([time, lifetime, stopTime]);
  if (
    !uint(parentFlags, 0xffff) ||
    !uint(actorFlags, 0xff) ||
    !uint(emitterFlags, 0xff) ||
    !uint(linkControllerCount, 0xffffffff)
  )
    throw Error("Explicit typed emitter lifecycle flags required");
  let stopRequested = f(time) > f(parentFlags & 0x20 ? stopTime : lifetime);
  let finishedCandidate = stopRequested;
  const singleEmissionBypassed = !!(emitterFlags & 0x10 && actorFlags & 4);
  if (emitterFlags & 0x10 && actorFlags & 4 && !linkControllerCount)
    finishedCandidate = true;
  if (emitterFlags & 0x10) stopRequested = finishedCandidate;
  return { stopRequested, finishedCandidate, singleEmissionBypassed };
}

// Original 175853d..17585e3. Call only when the single-particle bypass above
// is false. A closed periodic window resets the original burst/accumulator
// fields; it is not equivalent to merely skipping this frame's birth.
export function directEmitterEmissionGate({
  time,
  lifetime,
  delay,
  activeTime,
  period,
  stopRequested,
  actorFlags,
}) {
  floats([time, lifetime, delay, activeTime, period]);
  if (
    !uint(actorFlags, 0xff) ||
    typeof stopRequested !== "boolean" ||
    !(f(period) > 0)
  )
    throw Error("Explicit emitter emission clock inputs required");
  if (
    actorFlags & 2 ||
    (f(delay) !== -1 && f(time) < f(delay)) ||
    (f(lifetime) >= 0 && f(lifetime) <= f(time))
  )
    return { emit: false, resetLoopState: false };
  const remainder = f(f(time) % f(period));
  if (!(f(activeTime) > remainder))
    return { emit: false, resetLoopState: true };
  return { emit: !stopRequested, resetLoopState: false };
}

// Original 175b1e0..175b352, before the existing particle controller call.
// Pair storage is [birthClock, lifetime]; lifetime is rewritten in place in the
// original. Return owned bytes so supplied observations remain immutable.
export function directEmitterTailLifetimes({
  lingerType,
  parentFlags,
  stopRequested,
  previousStopTime,
  time,
  cutoff,
  particles,
}) {
  floats([previousStopTime, time, cutoff]);
  if (
    !uint(lingerType, 0xff) ||
    !uint(parentFlags, 0xffff) ||
    typeof stopRequested !== "boolean" ||
    !pairs(particles)
  )
    throw Error("Explicit typed particle tail inputs required");
  const after = particles.map((p) => p.map(f));
  let stopTime = f(previousStopTime);
  if ((lingerType === 2 || parentFlags & 0x20) && stopRequested) {
    const initial =
      stopTime >= f(-1.0000009536743164) && stopTime <= f(-0.9999989867210388);
    if (initial) stopTime = f(time);
    if ((lingerType === 1 || lingerType === 2) && initial)
      for (const p of after) p[1] = f(f(f(time) - p[0]) + f(cutoff));
    else if (lingerType === 0)
      for (const p of after) if (p[1] > f(cutoff)) p[1] = f(cutoff);
  }
  return { stopTime, after: after.flat() };
}

// Original 175b361..175b3b5: completion remains true only when every live
// particle has STRICTLY exceeded its rewritten lifetime. No wait-empty rule.
export function directEmitterTailCompletion(actorFlags, time, particles) {
  floats([time]);
  if (!uint(actorFlags, 0xff) || !pairs(particles))
    throw Error("Explicit actor completion inputs required");
  let flags = actorFlags;
  for (const [birth, lifetime] of particles) {
    if (!(f(f(time) - f(birth)) > f(lifetime))) {
      flags &= 0xfe;
      break;
    }
  }
  return flags;
}

// Original 17638f3..1763ae8. Complex actor bit0, simple sibling byte+e4,
// and mesh virtual+58 are separate resolved inputs, not particle counts.
export function directParentCompletion(
  parentFlags,
  { complexFlags, simpleComplete, meshComplete },
) {
  if (
    !uint(parentFlags, 0xffff) ||
    !dense(complexFlags) ||
    complexFlags.some((v) => !uint(v, 0xff)) ||
    !dense(simpleComplete) ||
    !dense(meshComplete) ||
    [...simpleComplete, ...meshComplete].some((v) => typeof v !== "boolean")
  )
    throw Error("Explicit sibling completion inputs required");
  const complete =
    complexFlags.every((v) => !!(v & 1)) &&
    simpleComplete.every(Boolean) &&
    meshComplete.every(Boolean);
  return (parentFlags & 0xfffd) | (complete ? 2 : 0);
}

// Original 174c343..174c35f. Actual destruction and platform cleanup remain
// outside this kernel. Only the caller's owned retirement queue is considered.
export function directParentCollection({
  parentFlags,
  queued,
  managerForce,
  force,
}) {
  if (
    !uint(parentFlags, 0xffff) ||
    [queued, managerForce, force].some((v) => typeof v !== "boolean")
  )
    throw Error("Explicit parent collection inputs required");
  return queued && (!!(parentFlags & 2) || managerForce || force);
}
