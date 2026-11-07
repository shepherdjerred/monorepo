const f = Math.fround;
const keys = (value, expected) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const array = (value, length) =>
  Array.isArray(value) &&
  value.length === length &&
  Reflect.ownKeys(value).length === length + 1 &&
  Array.from({ length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const number = (value) =>
  typeof value === "number" && Number.isFinite(f(value));
const vector = (value) => array(value, 3) && value.every(number);

// Original IntegratedValueVector3 postload177f850 selects64 samples. The
// integration builder1781d10 uses a binary32 1e-5 segment denominator bias;
// even a flat rate4 integrates to3.999959945678711 at normalized time1.
// This slice admits only two endpoint keys with identical, unrandomized rates.
export function compileDirectIntegratedRotation(value) {
  if (
    !keys(value, ["__type", "constantValue", "dynamics"]) ||
    value.__type !== "IntegratedValueVector3" ||
    !vector(value.constantValue) ||
    !value.constantValue.every((v) => Object.is(v, 1))
  )
    return null;
  const d = value.dynamics;
  if (
    !keys(d, ["__type", "times", "values"]) ||
    d.__type !== "VfxAnimatedVector3fVariableData" ||
    !array(d.times, 2) ||
    !Object.is(d.times[0], 0) ||
    !Object.is(d.times[1], 1) ||
    !array(d.values, 2) ||
    !d.values.every(vector) ||
    !d.values[0].every((v, i) => Object.is(f(v), f(d.values[1][i])))
  )
    return null;
  const epsilon = f(0.00001),
    denominator = f(f(1 - 0) + epsilon);
  const coefficients = d.values[0].map((v) => {
    v = f(v);
    return [
      f(f(f(v - v) / denominator) * 0.5),
      f(f(f(v * 1) - f(v * 0)) / denominator),
    ];
  });
  const samples = [];
  for (let i = 0; i < 64; i++) {
    const time = f(i / 63);
    for (const [a, b] of coefficients) {
      const initial = f(0 - f(f(f(a * 0) + b) * 0));
      samples.push(f(f(f(f(a * time) + b) * time) + initial));
    }
  }
  return Object.freeze({ sampleCount: 64, samples: Object.freeze(samples) });
}

export function sampleDirectIntegratedRotation(program, fraction) {
  if (
    !number(fraction) ||
    program?.sampleCount !== 64 ||
    !Array.isArray(program.samples) ||
    program.samples.length !== 192
  )
    throw Error(
      "Verified integrated rotation samples and finite fraction required",
    );
  const time = f(Math.min(1, Math.max(0, f(fraction))));
  const at = f(63 * time),
    index = Math.trunc(at);
  if (index >= 63) return program.samples.slice(189, 192);
  const weight = f(at - index),
    previous = f(1 - weight);
  return [0, 1, 2].map((lane) =>
    f(
      f(program.samples[(index + 1) * 3 + lane] * weight) +
        f(program.samples[index * 3 + lane] * previous),
    ),
  );
}

// Called once at the compiled-program boundary. Hot particle sampling consumes
// this verified immutable table without rescanning192 lanes on every draw.
export function validateDirectIntegratedRotation(program, source, primitive) {
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error("Compiled rotation source object required");
  const authored = ["rotation0", "isRotationEnabled"].some((key) =>
    Object.hasOwn(source, key),
  );
  if (!authored) {
    if (
      source.rotation0 !== undefined ||
      source.isRotationEnabled !== undefined ||
      (program !== null && program !== undefined)
    )
      throw Error("Unexpected compiled integrated rotation metadata");
    return program;
  }
  if (
    primitive !== "camera-quad" ||
    !Object.hasOwn(source, "rotation0") ||
    !Object.hasOwn(source, "isRotationEnabled") ||
    ![0, 1, false, true].includes(source.isRotationEnabled)
  )
    throw Error("Exact camera integrated rotation source required");
  const expected = compileDirectIntegratedRotation(source.rotation0);
  if (!expected) throw Error("Unverified integrated rotation source");
  if (!source.isRotationEnabled) {
    if (program !== null)
      throw Error("Disabled integrated rotation must retain null program");
    return program;
  }
  if (
    !keys(program, ["sampleCount", "samples"]) ||
    program.sampleCount !== 64 ||
    !array(program.samples, 192) ||
    !program.samples.every((v, i) => Object.is(v, expected.samples[i]))
  )
    throw Error("Compiled integrated rotation table differs from source");
  return program;
}

// Original175e32f..175e35d multiplies the normalized integral by60 first,
// then by the particle lifetime, and adds the preexisting birth/angular value.
export function applyDirectIntegratedRotation(rotation, integral, lifetime) {
  if (
    !vector(rotation) ||
    !vector(integral) ||
    !number(lifetime) ||
    f(lifetime) <= 0
  )
    throw Error(
      "Finite rotation, sampled integral and positive lifetime required",
    );
  lifetime = f(lifetime);
  return rotation.map((v, lane) =>
    f(f(v) + f(f(integral[lane] * 60) * lifetime)),
  );
}

export function directIntegratedParticleRotation(
  rotation,
  program,
  age,
  lifetime,
) {
  if (
    !vector(rotation) ||
    !number(age) ||
    !number(lifetime) ||
    f(lifetime) <= 0
  )
    throw Error("Finite particle rotation, age and positive lifetime required");
  lifetime = f(lifetime);
  if (lifetime === 3.4028234663852886e38) return rotation.map(f);
  const integral = sampleDirectIntegratedRotation(
    program,
    f(f(age) / lifetime),
  );
  return applyDirectIntegratedRotation(rotation, integral, lifetime);
}
