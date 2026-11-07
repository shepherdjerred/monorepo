const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1],
  yaw90 = [0, 0, -1, 0, 1, 0, 1, 0, 0];

// Tool-only supplied world: same bend and orientation schedule as the original
// unchanged trail controls, translated by the explicitly supplied event root.
export function directLoadWorldPlacement(event, time) {
  if (
    event.descriptor ||
    event.placement?.kind !== "explicit-world" ||
    event.placement.position?.length !== 3 ||
    !event.placement.position.every(Number.isFinite) ||
    !Number.isFinite(time) ||
    time < event.time
  )
    throw Error("Finite explicit performance-fixture root required");
  const age = time - event.time,
    orientationAge = Math.fround(age),
    base = event.placement.position,
    motion = [Math.min(age, 0.4) * 130, age * 3, Math.max(age - 0.4, 0) * 170];
  return {
    resolved: true,
    boundObjectSize: 0,
    boundObjectSizeStatus: "supplied-native-component-control-zero",
    position: base.map((n, lane) => n + motion[lane]),
    basis: [
      ...(orientationAge >= 0.5 && orientationAge < Math.fround(70 / 60)
        ? yaw90
        : identity),
    ],
    reasons: [],
  };
}
