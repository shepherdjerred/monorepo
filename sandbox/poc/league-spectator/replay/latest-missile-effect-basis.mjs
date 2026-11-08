const f = Math.fround;
const epsilon = f(1e-9);
const nearUpLower = f(0.9999989867210388);
const nearUpUpper = f(1.0000009536743164);
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every(
    (n) => typeof n === "number" && Number.isFinite(n) && Number.isFinite(f(n)),
  );

export const MISSILE_EFFECT_BASIS_POLICY =
  "original-zero-turn-missile-velocity-effect-basis-v1";
const turnNames = [
  "MissileEffectMaxTurnSpeedDegreesPerSecond",
  "MissileEffectMaximumAngleDegrees",
];
const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

export function compileMissileEffectBasisProgram(spellData, source) {
  if (
    spellData?.mMissileSpec?.movementComponent?.__type !==
      "FixedTimeMovement" ||
    !source?.catalogSha256
  )
    return null;
  for (const name of turnNames)
    if (Object.hasOwn(spellData, name) && spellData[name] !== 0) return null;
  const program = {
    schema: 1,
    policy: MISSILE_EFFECT_BASIS_POLICY,
    movementType: "FixedTimeMovement",
    spellHash: source.spellHash,
    spellName: source.spellName,
    catalogSha256: source.catalogSha256,
    turnSpeed: 0,
    maximumAngle: 0,
  };
  validateMissileEffectBasisProgram(program);
  return Object.freeze(program);
}

// The owned type1 caster context calls this only after its actual named-bone
// start resolved. Unknown specification options retain an unresolved basis;
// the original callback fixture proves the default visibility/config branch.
export function compileTrackingFixedSpeedEffectBasisProgram(spellData, source) {
  const spec = spellData?.mMissileSpec,
    movement = spec?.movementComponent;
  if (
    spellData?.mCastType !== 1 ||
    spec?.__type !== "MissileSpecification" ||
    movement?.__type !== "FixedSpeedMovement" ||
    (Object.hasOwn(movement, "mTracksTarget")
      ? movement.mTracksTarget
      : true) !== true ||
    (Object.hasOwn(movement, "mTargetBoneName")
      ? movement.mTargetBoneName
      : "") !== "" ||
    typeof movement.mStartBoneName !== "string" ||
    !movement.mStartBoneName.length ||
    !source?.catalogSha256 ||
    Object.keys(spec).some(
      (key) =>
        ![
          "__type",
          "mMissileWidth",
          "movementComponent",
          "verticalFacing",
          "behaviors",
        ].includes(key),
    )
  )
    return null;
  for (const name of turnNames)
    if (Object.hasOwn(spellData, name) && !Object.is(spellData[name], 0))
      return null;
  const program = {
    schema: 1,
    policy: MISSILE_EFFECT_BASIS_POLICY,
    movementType: "FixedSpeedMovement",
    spellHash: source.spellHash,
    spellName: source.spellName,
    catalogSha256: source.catalogSha256,
    turnSpeed: 0,
    maximumAngle: 0,
  };
  validateMissileEffectBasisProgram(program);
  return Object.freeze(program);
}

export function validateMissileEffectBasisProgram(program, source = null) {
  if (
    !program ||
    Object.keys(program).sort().join(",") !==
      [
        "schema",
        "policy",
        "movementType",
        "spellHash",
        "spellName",
        "catalogSha256",
        "turnSpeed",
        "maximumAngle",
      ]
        .sort()
        .join(",") ||
    program.schema !== 1 ||
    program.policy !== MISSILE_EFFECT_BASIS_POLICY ||
    !["FixedTimeMovement", "FixedSpeedMovement"].includes(
      program.movementType,
    ) ||
    !uint(program.spellHash) ||
    typeof program.spellName !== "string" ||
    !program.spellName.length ||
    !/^[a-f0-9]{64}$/.test(program.catalogSha256) ||
    program.turnSpeed !== 0 ||
    program.maximumAngle !== 0 ||
    (source &&
      (program.spellHash !== source.spellHash ||
        program.spellName !== source.spellName ||
        (source.movementType !== undefined &&
          program.movementType !== source.movementType)))
  )
    throw Error(
      "Exact-build generated zero-turn missile basis program required",
    );
  return program;
}

export function validateMissileEffectBasisStates(program, states, source) {
  // This validates the generated-presentation numerical contract. The source
  // builder hashes the catalog bytes; this synchronous serialized boundary
  // retains that digest but does not independently reload or hash the catalog.
  validateMissileEffectBasisProgram(program, source);
  let basis = null;
  for (const state of states) {
    if (!vector(state.velocity) || typeof state.stopped !== "boolean")
      throw Error("Ordered finite missile basis inputs required");
    if (
      basis === null &&
      (!state.velocity.some((n) => f(n) !== 0) || state.stopped)
    )
      throw Error(
        "Nonzero constructor missile velocity required; fallback direction remains unresolved",
      );
    if (!state.stopped)
      basis = zeroTurnMissileEffectBasis(state.velocity).basis;
    if (
      !Array.isArray(state.effectBasis) ||
      state.effectBasis.length !== 9 ||
      state.effectBasis.some((lane, index) => !Object.is(lane, basis[index]))
    )
      throw Error(
        "Serialized missile effect basis differs from original velocity callback",
      );
  }
  if (basis === null)
    throw Error("Initial missile effect basis state required");
}

function normalize(v) {
  const square = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (square <= epsilon) return v;
  const inverse = f(1 / f(Math.sqrt(square)));
  return v.map((lane) => f(lane * inverse));
}

// Original 894330 normalizes the actor's applied velocity before the full
// 1767230 direction setter. The latter normalizes its input and, in its general
// branch, its forward row again. These repeated operations are observable.
// Direction smoothing must be established absent by the owning spell policy.
export function zeroTurnMissileEffectBasis(velocity) {
  if (!vector(velocity))
    throw Error("Finite float32 missile velocity required");
  const direction = normalize(velocity.map(f));
  const input = normalize([...direction]);
  const dot = f(f(f(input[0] * 0) + input[1]) + f(input[2] * 0));
  if (dot <= nearUpUpper && dot >= nearUpLower)
    return { direction, basis: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const forward = normalize([...input]);
  const [x, y, z] = forward;
  const right = normalize([
    f(f(y * 0) + -z),
    f(f(z * 0) + f(x * -0)),
    f(f(y * -0) + x),
  ]);
  const up = normalize([
    f(f(z * right[1]) - f(right[2] * y)),
    f(f(x * right[2]) - f(right[0] * z)),
    f(f(right[0] * y) - f(x * right[1])),
  ]);
  return { direction, basis: [...right, ...forward, ...up] };
}
