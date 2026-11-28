const f32 = Math.fround;
const targetTolerance = f32(0.00001);

/**
 * The .8428 Maokai R movement gate with zero terminal radius and no
 * one-step overshoot grace. The original test uses X/Z and float32 arithmetic.
 * When a proposal reaches the target, the caller must exclude it from the
 * render trace and use the last proven open sample as an exclusive cutoff.
 * @param {readonly [number, number, number]} position
 * @param {readonly [number, number, number]} delta
 * @param {readonly [number, number, number]} target
 * @throws {RangeError} If a vector lacks three finite float32-compatible lanes.
 */
export function reachesRiftProjectileTarget(position, delta, target) {
  for (const vector of [position, delta, target]) {
    if (
      vector.length !== 3 ||
      ![...vector].every(
        (lane) => Number.isFinite(lane) && Number.isFinite(f32(lane)),
      )
    )
      throw new RangeError(
        "Rift projectile movement requires finite float32 XYZ vectors.",
      );
  }

  const x = f32(position[0]);
  const z = f32(position[2]);
  const stepX = f32(delta[0]);
  const stepZ = f32(delta[2]);
  const targetX = f32(target[0]);
  const targetZ = f32(target[2]);
  const afterX = f32(targetX - f32(x + stepX));
  const afterZ = f32(targetZ - f32(z + stepZ));
  if (
    Math.abs(afterX) <= targetTolerance &&
    Math.abs(afterZ) <= targetTolerance
  )
    return true;

  const dot = (remainingX, remainingZ) =>
    f32(f32(stepX * remainingX) + f32(stepZ * remainingZ));
  return (
    dot(f32(targetX - x), f32(targetZ - z)) > 0 && dot(afterX, afterZ) <= 0
  );
}
