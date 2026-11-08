// Components of the exact-build missile controller. These functions do not
// establish actor initialization, tracked-target updates or particle lifetimes.
// latest-missile-frame.mjs composes them for an explicitly gated owned snapshot.
export function createLatestMissileControllers(definition) {
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    definition.arrivalRva !== 0x88be60 ||
    definition.snapRva !== 0x88bc40 ||
    definition.progressRva !== 0x88d240 ||
    definition.heightSolvers.FollowTerrainHeightSolver.evaluateRva !==
      0x882800 ||
    definition.heightSolvers.BlendedLinearHeightSolver.evaluateRva !== 0x882770
  )
    throw Error("Unsupported missile controller package");
  const f = Math.fround,
    constants = Object.fromEntries(
      Object.entries(definition.constants).map(([name, item]) => {
        if (!Number.isFinite(item.value) || f(item.value) !== item.value)
          throw Error("Invalid native missile controller constant");
        return [name, item.value];
      }),
    ),
    epsilon = constants.epsilon;
  if (
    !(epsilon > 0) ||
    constants.progressDefault !== 1 ||
    constants.blendedExponent !== 0.75 ||
    constants.groundClearance !== 4
  )
    throw Error(
      "Missile controller constants differ from supported native code",
    );
  const vector = (values) => {
    if (
      !Array.isArray(values) ||
      values.length !== 3 ||
      !values.every(Number.isFinite)
    )
      throw Error("Invalid missile controller vector");
    const result = values.map(f);
    if (!result.every(Number.isFinite))
      throw Error("Missile controller vector exceeds float32");
    return result;
  };
  const distanceSquared = (a, b) => {
    const x = f(a[0] - b[0]),
      z = f(a[2] - b[2]);
    return f(f(x * x) + f(z * z));
  };
  const dot = (a, b) => f(f(a[2] * b[2]) + f(f(a[0] * b[0]) + 0));
  function fixedSpeedArrival(
    position,
    target,
    displacement,
    radius,
    canPassOnce,
  ) {
    position = vector(position);
    target = vector(target);
    displacement = vector(displacement);
    radius = f(radius);
    if (!Number.isFinite(radius) || typeof canPassOnce !== "boolean")
      throw Error("Invalid missile arrival inputs");
    const predicted = position.map((value, lane) =>
      f(value + displacement[lane]),
    );
    if (radius > 0 && f(radius * radius) > distanceSquared(predicted, target))
      return { arrived: true, canPassOnce };
    const remaining = target.map((value, lane) => f(value - position[lane]));
    if (Math.abs(remaining[0]) <= epsilon && Math.abs(remaining[2]) <= epsilon)
      return { arrived: true, canPassOnce };
    if (!(dot(remaining, displacement) > 0))
      return { arrived: false, canPassOnce };
    const after = target.map((value, lane) => f(value - predicted[lane]));
    if (!(dot(after, displacement) <= 0))
      return { arrived: false, canPassOnce };
    return canPassOnce
      ? { arrived: false, canPassOnce: false }
      : { arrived: true, canPassOnce };
  }
  function snapDisplacement(position, target, displacement, radius) {
    position = vector(position);
    target = vector(target);
    displacement = vector(displacement);
    if (!Number.isFinite(radius)) throw Error("Invalid missile snap radius");
    return f(radius) === 0
      ? target.map((value, lane) => f(value - position[lane]))
      : displacement;
  }
  function fixedSpeedProgress(start, target, predicted, arrived) {
    start = vector(start);
    target = vector(target);
    predicted = vector(predicted);
    if (typeof arrived !== "boolean")
      throw Error("Invalid missile arrival flag");
    if (
      arrived ||
      (Math.abs(f(start[0] - predicted[0])) <= epsilon &&
        Math.abs(f(start[2] - predicted[2])) <= epsilon) ||
      (Math.abs(f(start[0] - target[0])) <= epsilon &&
        Math.abs(f(start[2] - target[2])) <= epsilon)
    )
      return constants.progressDefault;
    const traveled = f(Math.sqrt(distanceSquared(start, predicted))),
      total = f(Math.sqrt(distanceSquared(start, target)));
    return Math.min(constants.progressDefault, f(traveled / total));
  }
  function heightSettings(spec) {
    if (!spec || typeof spec.__type !== "string")
      throw Error("Missing missile height-solver type");
    const type = definition.heightSolvers[spec.__type];
    if (!type)
      return { type: spec.__type, status: "untranslated", settings: null };
    const settings = Object.fromEntries(
      Object.entries(type.fields).map(([name, item]) => {
        const value = Object.hasOwn(spec, name) ? spec[name] : item.default;
        if (!Number.isFinite(value) || !Number.isFinite(f(value)))
          throw Error(`Invalid missile height property ${name}`);
        return [name, f(value)];
      }),
    );
    return {
      type: spec.__type,
      status: type.externalMath
        ? "translated-external-powf-unverified"
        : "translated",
      settings,
      uninterpretedFields: Object.keys(spec).filter(
        (name) => name !== "__type" && !Object.hasOwn(type.fields, name),
      ),
    };
  }
  function followTerrainHeight(current, predicted, settings, terrain) {
    current = vector(current);
    predicted = vector(predicted);
    if (![settings.mHeightOffset, settings.mMaxSlope].every(Number.isFinite))
      throw Error("Invalid follow-terrain height settings");
    const ground = terrain.sampleHeight(predicted[0], predicted[2]);
    if (!ground.inside) return current[1];
    const desired = f(ground.height + f(settings.mHeightOffset)),
      limit = f(
        f(Math.sqrt(distanceSquared(predicted, current))) *
          f(settings.mMaxSlope),
      ),
      delta = f(desired - current[1]),
      change = limit < delta ? limit : Math.max(-limit, delta);
    return f(change + current[1]);
  }
  function blendedLinearHeight(start, target, predicted, progress, terrain) {
    start = vector(start);
    target = vector(target);
    predicted = vector(predicted);
    progress = f(progress);
    if (!Number.isFinite(progress) || progress < 0)
      throw Error("Invalid blended-height progress");
    // Original code calls imported powf. Math.pow followed by float32 rounding
    // is compared against a Windows CRT adapter; original macOS libm parity is
    // explicitly unverified and is not promoted to native A/V equivalence.
    const shaped = f(Math.pow(progress, constants.blendedExponent)),
      blended = f(f(f(target[1] - start[1]) * shaped) + start[1]),
      ground = terrain.sampleHeight(predicted[0], predicted[2]);
    return ground.inside && ground.height > blended
      ? f(ground.height + constants.groundClearance)
      : blended;
  }
  function faceTargetVerticalVelocity(target, predicted, speed) {
    target = vector(target);
    predicted = vector(predicted);
    speed = f(speed);
    if (!Number.isFinite(speed)) throw Error("Invalid missile facing speed");
    let delta = target.map((n, i) => f(n - predicted[i]));
    const squared = f(
      f(f(delta[0] * delta[0]) + f(delta[1] * delta[1])) +
        f(delta[2] * delta[2]),
    );
    if (squared > constants.normalizationEpsilon) {
      const reciprocal = f(1 / f(Math.sqrt(squared)));
      delta = delta.map((n) => f(n * reciprocal));
    }
    return f(speed * delta[1]);
  }
  return {
    fixedSpeedArrival,
    snapDisplacement,
    fixedSpeedProgress,
    heightSettings,
    followTerrainHeight,
    blendedLinearHeight,
    faceTargetVerticalVelocity,
  };
}
