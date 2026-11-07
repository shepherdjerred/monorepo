// Original callback 890880 consumes the post-height-solver displacement and
// supplied global frame delta. It does not infer the recorded game's schedule.
const f = Math.fround;
export const MATCH_VELOCITY_FACING_CONTRACT = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  className: "VeritcalFacingMatchVelocity",
  factoryRva: 0x874930,
  bindRva: 0x88be50,
  evaluateRva: 0x890880,
  thresholdRva: 0x20ca4d0,
  threshold: f(1e-9),
});
export function matchVelocityVerticalFacing(displacement, delta) {
  if (
    !Array.isArray(displacement) ||
    displacement.length !== 3 ||
    !displacement.every(
      (value) => Number.isFinite(value) && Number.isFinite(f(value)),
    ) ||
    !Number.isFinite(delta) ||
    !Number.isFinite(f(delta))
  )
    throw Error("Finite float32 MatchVelocity callback inputs required");
  delta = f(delta);
  return delta > MATCH_VELOCITY_FACING_CONTRACT.threshold
    ? f(f(displacement[1]) / delta)
    : 0;
}
export function stepPresentationMissileFrame(
  baseFrame,
  state,
  now,
  delta,
  globalDelta = delta,
) {
  const match =
    state.verticalFacingType === MATCH_VELOCITY_FACING_CONTRACT.className;
  if (!match) return baseFrame.step(state, now, delta);
  if (
    !Number.isFinite(globalDelta) ||
    !Number.isFinite(f(globalDelta)) ||
    globalDelta < 0
  )
    throw Error("Finite nonnegative global MatchVelocity frame delta required");
  state.verticalFacingType = null;
  let result;
  try {
    result = baseFrame.step(state, now, delta);
  } finally {
    state.verticalFacingType = MATCH_VELOCITY_FACING_CONTRACT.className;
  }
  result.velocity[1] = matchVelocityVerticalFacing(
    result.displacement,
    globalDelta,
  );
  state.velocity = result.velocity.every((lane) => lane === 0)
    ? [...state.cachedVelocity]
    : [...result.velocity];
  result.appliedVelocity = [...state.velocity];
  return result;
}
