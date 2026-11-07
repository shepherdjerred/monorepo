// Replay-derived positions; activation/seed/basis remain explicit preview policy.
import { sampleLatestMissileTrace } from "./latest-missile-playback.mjs";
export const PARENT_MISSILE_POLICY = Object.freeze({
  activation: "missile-start",
  stop: "suspend-at-observed-stop",
  seed: "0",
  quality: 0,
  cadenceHz: 60,
  clock: "absolute-float32-replay-time-plus-stop-boundaries",
  basis: "local-Y-flight-local-Z-up",
  originalEffectLifetimeRecovered: false,
  originalSeedAndJobOrderingRecovered: false,
});
const unit = (v) => {
  const length = Math.hypot(...v);
  if (!(length > 0) || !Number.isFinite(length))
    throw Error("Degenerate parent missile direction");
  return v.map((n) => n / length);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function parentMissilePlacement(trace, time) {
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(trace.startTime) ||
    !Number.isFinite(trace.stopTime) ||
    trace.stopTime < trace.startTime ||
    Math.fround(time) < Math.fround(trace.startTime)
  )
    throw Error(
      "Parent missile placement requires an admitted finite lifetime",
    );
  const sourceTime =
    Math.fround(time) >= Math.fround(trace.stopTime)
      ? trace.stopTime
      : Math.max(trace.startTime, time);
  const pose = sampleLatestMissileTrace(trace, sourceTime),
    forward = unit(pose.direction);
  const reference = Math.abs(forward[1]) < 0.999 ? [0, 1, 0] : [0, 0, 1],
    left = unit(cross(forward, reference)),
    up = unit(cross(left, forward));
  return {
    position: pose.position.map(Math.fround),
    basis: [...left, 0, ...forward, 0, ...up, 0, 0, 0, 0, 1].map(Math.fround),
  };
}
export function buildParentMissileBursts(traces, { duration = 0.3 } = {}) {
  if (
    !Array.isArray(traces) ||
    !traces.length ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 30
  )
    throw Error("Bounded nonempty parent missile traces required");
  const sequences = new Set(),
    groups = new Map();
  for (const trace of traces) {
    if (
      !Number.isSafeInteger(trace.sequence) ||
      sequences.has(trace.sequence) ||
      typeof trace.effectId !== "string" ||
      !Array.isArray(trace.states) ||
      !trace.states.length ||
      !Number.isFinite(trace.startTime) ||
      !Number.isFinite(trace.stopTime) ||
      trace.stopTime < trace.startTime
    )
      throw Error("Invalid or duplicate parent missile trace");
    sequences.add(trace.sequence);
    const start = Math.fround(trace.startTime),
      key = `${trace.effectId}:${start}`;
    if (!groups.has(key))
      groups.set(key, {
        effectId: trace.effectId,
        startTime: start,
        traces: [],
      });
    groups.get(key).traces.push(trace);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.startTime - b.startTime || a.effectId.localeCompare(b.effectId),
    )
    .map((group) => {
      group.traces.sort((a, b) => a.sequence - b.sequence);
      const end = Math.fround(group.startTime + duration),
        times = new Set();
      for (
        let tick = 1;
        Math.fround(group.startTime + tick / 60) <= end;
        tick++
      )
        times.add(Math.fround(group.startTime + tick / 60));
      times.add(end);
      for (const trace of group.traces) {
        const stop = Math.fround(trace.stopTime);
        if (stop > group.startTime && stop <= end) times.add(stop);
      }
      const stopped = new Set();
      return {
        effectId: group.effectId,
        startTime: group.startTime,
        endTime: end,
        parents: group.traces.map((trace) => ({
          sequence: trace.sequence,
          entityId: trace.entityId,
          stopTime: Math.fround(trace.stopTime),
          renderParticlesAfterDestroy: trace.renderParticlesAfterDestroy,
          seed: "0",
          clock: {
            ticks: [0, 1, 2].map(() =>
              String(Math.round(trace.startTime * 1e9)),
            ),
            mode: 0,
            timebase: [1, 1],
          },
          placement: parentMissilePlacement(trace, group.startTime),
        })),
        frames: [...times]
          .sort((a, b) => a - b)
          .map((time) => ({
            time,
            updates: group.traces.map((trace) => {
              const suspension =
                !stopped.has(trace.sequence) &&
                time >= Math.fround(trace.stopTime);
              if (suspension) stopped.add(trace.sequence);
              return {
                sequence: trace.sequence,
                time,
                maxSubsteps: 20,
                placement: parentMissilePlacement(trace, time),
                ...(suspension ? { suspended: true } : {}),
              };
            }),
          })),
      };
    });
}
