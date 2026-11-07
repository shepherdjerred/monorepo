// Original multiply-UV matrix 0x175fec0 and quad-writer corner transforms.
// Constant birth inputs and normalized particle-age scale curves consume no
// additional particle RNG/state. Scrolling and atlas variants remain guarded.
// Material selection and texture presence must be established independently.
import { directTrailHalf } from "./latest-direct-effect-trail.mjs";
const f = Math.fround;
export const DIRECT_CONSTANT_MULT_UV_POLICY = "native-constant-mult-uv-v1";
export const DIRECT_SCALE_CURVE_MULT_UV_POLICY =
  "native-scale-curve-mult-uv-v1";
const plain = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const finite = (v) => typeof v === "number" && Number.isFinite(f(v));
const dense = (v, width) =>
  Array.isArray(v) &&
  v.length === width &&
  Reflect.ownKeys(v).length === width + 1 &&
  Array.from({ length: width }, (_, i) => Object.hasOwn(v, i)).every(Boolean);
function constant(value, type, width, fallback) {
  if (value === undefined) return width === 1 ? fallback : [...fallback];
  if (
    !plain(value) ||
    value.__type !== type ||
    Reflect.ownKeys(value).some((k) => !["__type", "constantValue"].includes(k))
  )
    return null;
  const v = Object.hasOwn(value, "constantValue")
    ? value.constantValue
    : fallback;
  if (width === 1) return finite(v) ? f(v) : null;
  return dense(v, width) && v.every(finite) ? v.map(f) : null;
}
export function compileDirectConstantMultUv(source, primitive) {
  if (
    !plain(source) ||
    !["camera-quad", "arbitrary-quad"].includes(primitive) ||
    !Object.hasOwn(source, "textureMult") ||
    !plain(source.textureMult) ||
    !Object.hasOwn(source.textureMult, "__type") ||
    source.textureMult.__type !== "VfxTextureMultDefinitionData" ||
    ["particleColorTexture", "texDiv", "numFrames"].some((k) =>
      Object.hasOwn(source, k),
    )
  )
    return null;
  const m = source.textureMult;
  if (
    Reflect.ownKeys(m).some(
      (k) =>
        ![
          "__type",
          "textureMult",
          "texAddressModeMult",
          "UvRotationMult",
          "birthUVOffsetMult",
          "uvScaleMult",
        ].includes(k),
    ) ||
    typeof m.textureMult !== "string" ||
    m.textureMult.length === 0 ||
    ["UvRotationMult", "birthUVOffsetMult", "uvScaleMult"].some(
      (k) => Object.hasOwn(m, k) && m[k] === undefined,
    ) ||
    (Object.hasOwn(m, "texAddressModeMult") &&
      ![0, 1, 2].includes(m.texAddressModeMult))
  )
    return null;
  const rotation = constant(m.UvRotationMult, "ValueFloat", 1, 0),
    offset = constant(m.birthUVOffsetMult, "ValueVector2", 2, [0, 0]),
    scale = constant(m.uvScaleMult, "ValueVector2", 2, [1, 1]);
  if (rotation === null || offset === null || scale === null) return null;
  const program = {
    schema: 1,
    policy: DIRECT_CONSTANT_MULT_UV_POLICY,
    texture: m.textureMult,
    addressMode: m.texAddressModeMult ?? 0,
    rotation,
    offset,
    scale,
    linked:
      rotation !== 0 ||
      offset.some((n) => n !== 0) ||
      scale.some((n) => n !== 1),
  };
  try {
    if (
      directConstantMultUvCorners(program).some(
        (half) => (half & 0x7c00) === 0x7c00,
      )
    )
      return null;
  } catch {
    return null;
  }
  return program;
}
const same = (a, b) => {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (Array.isArray(a) || Array.isArray(b))
    return (
      dense(a, b.length) &&
      dense(b, b.length) &&
      a.every((v, i) => same(v, b[i]))
    );
  if (plain(a) && plain(b))
    return (
      Reflect.ownKeys(a).length === Reflect.ownKeys(b).length &&
      Reflect.ownKeys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
    );
  return a === b;
};
export function validateDirectConstantMultUv(emitter) {
  if (emitter?.multUvProgram == null) {
    if (plain(emitter?.source) && Object.hasOwn(emitter.source, "textureMult"))
      throw Error("Authored multiply texture requires its verified UV program");
    return false;
  }
  const expected = compileDirectConstantMultUv(
    emitter?.source,
    emitter?.primitive,
  );
  if (!expected || !same(expected, emitter.multUvProgram))
    throw Error(
      "Constant multiply-UV program differs from its complete authored source",
    );
  return true;
}
function scaleCurve(field) {
  if (
    !plain(field) ||
    !Object.hasOwn(field, "__type") ||
    field.__type !== "ValueVector2" ||
    Reflect.ownKeys(field).some(
      (k) => !["__type", "constantValue", "dynamics"].includes(k),
    ) ||
    (Object.hasOwn(field, "constantValue") &&
      (!dense(field.constantValue, 2) || !field.constantValue.every(finite))) ||
    !Object.hasOwn(field, "dynamics") ||
    !plain(field.dynamics)
  )
    return false;
  const d = field.dynamics;
  if (
    d.__type !== "VfxAnimatedVector2fVariableData" ||
    !Object.hasOwn(d, "__type") ||
    !Object.hasOwn(d, "times") ||
    !Object.hasOwn(d, "values") ||
    Reflect.ownKeys(d).some(
      (k) => !["__type", "times", "values", "probabilityTables"].includes(k),
    ) ||
    !Array.isArray(d.times) ||
    d.times.length < 1 ||
    d.times.length > 64 ||
    !dense(d.times, d.times.length) ||
    !dense(d.values, d.times.length) ||
    !d.times.every(
      (t, i) =>
        finite(t) &&
        (i === 0 ||
          (f(t) > f(d.times[i - 1]) && finite(f(t) - f(d.times[i - 1])))),
    ) ||
    !d.values.every(
      (v, i) =>
        dense(v, 2) &&
        v.every(
          (n, lane) =>
            finite(n) && (i === 0 || finite(f(n) - f(d.values[i - 1][lane]))),
        ),
    )
  )
    return false;
  return (
    !Object.hasOwn(d, "probabilityTables") ||
    (dense(d.probabilityTables, 2) &&
      d.probabilityTables.every(
        (p) =>
          plain(p) &&
          Reflect.ownKeys(p).length === 1 &&
          Object.hasOwn(p, "__type") &&
          p.__type === "VfxProbabilityTableData",
      ))
  );
}
export function compileDirectMultUv(source, primitive) {
  const constantProgram = compileDirectConstantMultUv(source, primitive);
  if (constantProgram) return constantProgram;
  if (
    !plain(source) ||
    !plain(source.textureMult) ||
    !scaleCurve(source.textureMult.uvScaleMult)
  )
    return null;
  const neutral = compileDirectConstantMultUv(
    {
      ...source,
      textureMult: {
        ...source.textureMult,
        uvScaleMult: { __type: "ValueVector2", constantValue: [1, 1] },
      },
    },
    primitive,
  );
  if (!neutral) return null;
  for (const value of source.textureMult.uvScaleMult.dynamics.values) {
    try {
      if (
        directConstantMultUvCorners({ ...neutral, scale: value.map(f) }).some(
          (half) => (half & 0x7c00) === 0x7c00,
        )
      )
        return null;
    } catch {
      return null;
    }
  }
  const { scale: _scale, ...base } = neutral;
  return {
    ...base,
    policy: DIRECT_SCALE_CURVE_MULT_UV_POLICY,
    clock: "normalized-particle-age",
    scaleField: structuredClone(source.textureMult.uvScaleMult),
    linked: true,
  };
}
export function validateDirectMultUv(emitter) {
  if (emitter?.multUvProgram == null) {
    if (plain(emitter?.source) && Object.hasOwn(emitter.source, "textureMult"))
      throw Error("Authored multiply texture requires its verified UV program");
    return false;
  }
  const expected = compileDirectMultUv(emitter?.source, emitter?.primitive);
  if (!expected || !same(expected, emitter.multUvProgram))
    throw Error(
      "Multiply-UV program differs from its complete authored source",
    );
  return true;
}
// Source omissions remain separate from later material/pass/sampler admission.
export function directMultUvSourceOmissions(source, primitive) {
  if (
    !plain(source) ||
    !Object.hasOwn(source, "textureMult") ||
    compileDirectMultUv(source, primitive)
  )
    return [];
  if (!plain(source.textureMult)) return ["mult-uv:invalid-definition"];
  const m = source.textureMult,
    reasons = [];
  if (!["camera-quad", "arbitrary-quad"].includes(primitive))
    reasons.push("mult-uv:primitive-untranslated");
  for (const key of ["particleColorTexture", "texDiv", "numFrames"])
    if (Object.hasOwn(source, key))
      reasons.push(`mult-uv:base-${key}-combination-untranslated`);
  for (const key of Object.keys(m))
    if (
      ![
        "__type",
        "textureMult",
        "texAddressModeMult",
        "UvRotationMult",
        "birthUVOffsetMult",
        "uvScaleMult",
      ].includes(key)
    )
      reasons.push(`mult-uv:field-${key}-untranslated`);
  if (typeof m.textureMult !== "string" || !m.textureMult.length)
    reasons.push("mult-uv:texture-resource-name-unresolved");
  if (constant(m.UvRotationMult, "ValueFloat", 1, 0) === null)
    reasons.push("mult-uv:rotation-requires-constant");
  if (constant(m.birthUVOffsetMult, "ValueVector2", 2, [0, 0]) === null)
    reasons.push("mult-uv:birth-offset-requires-constant");
  if (
    constant(m.uvScaleMult, "ValueVector2", 2, [1, 1]) === null &&
    !scaleCurve(m.uvScaleMult)
  )
    reasons.push("mult-uv:scale-curve-invalid-or-probability-untranslated");
  if (
    Object.hasOwn(m, "texAddressModeMult") &&
    ![0, 1, 2].includes(m.texAddressModeMult)
  )
    reasons.push("mult-uv:address-mode-untranslated");
  return reasons.length ? reasons : ["mult-uv:transform-inputs-unverified"];
}
function sampledProgram(program, normalizedAge, values) {
  if (program?.policy === DIRECT_CONSTANT_MULT_UV_POLICY) return program;
  if (
    program?.policy !== DIRECT_SCALE_CURVE_MULT_UV_POLICY ||
    program.clock !== "normalized-particle-age" ||
    !finite(normalizedAge) ||
    typeof values?.sample !== "function"
  )
    throw Error(
      "Verified multiply-UV scale program, particle clock and value kernel required",
    );
  const scale = values.sample(program.scaleField, f(normalizedAge), [1, 1]);
  if (!dense(scale, 2) || !scale.every(finite))
    throw Error("Finite sampled multiply scale required");
  return { ...program, scale };
}
export function sampleDirectMultUvMatrix(program, normalizedAge, values) {
  return directConstantMultUvMatrix(
    sampledProgram(program, normalizedAge, values),
  );
}
export function sampleDirectMultUvCorners(program, normalizedAge, values) {
  return directConstantMultUvCorners(
    sampledProgram(program, normalizedAge, values),
  );
}
function fraction(value) {
  const result = f(value - Math.trunc(value));
  return result === 0 && (value < 0 || Object.is(value, -0)) ? -0 : result;
}
export function directConstantMultUvMatrix(program) {
  const angle = f(program.rotation * f(Math.PI / 180)),
    sin = f(Math.sin(angle)),
    cos = f(Math.cos(angle)),
    [sx, sy] = program.scale;
  let m =
    angle === 0
      ? [1, 0, 0, 1, 0, 0]
      : [
          cos,
          f(-sin),
          sin,
          cos,
          f(f(f(f(-0.5) * cos) - f(f(0.5) * sin)) + f(0.5)),
          f(f(f(f(0.5) * sin) - f(f(0.5) * cos)) + f(0.5)),
        ];
  if (sx !== 1 || sy !== 1) {
    // Preserve the original rotation * centered-scale matrix composition,
    // including its explicit zero products and binary32 addition order.
    const [a, b, c, d, x, y] = m;
    m = [
      f(f(f(a * sx) + 0) + f(b * 0)),
      f(f(f(a * 0) + 0) + f(b * sy)),
      f(f(f(c * sx) + 0) + f(d * 0)),
      f(f(f(c * 0) + 0) + f(d * sy)),
      f(f(f(f(x * sx) + 0) + f(y * 0)) + f(f(0.5) * f(1 - sx))),
      f(f(f(f(x * 0) + 0) + f(y * sy)) + f(f(0.5) * f(1 - sy))),
    ];
  }
  m[4] = f(fraction(program.offset[0]) + m[4]);
  m[5] = f(fraction(program.offset[1]) + m[5]);
  if (!m.every(Number.isFinite)) throw Error("Nonfinite multiply-UV matrix");
  return new Float32Array(m);
}
// Only the texture-present writer branch is translated here. Without that
// resource the original writer instead emits the particle's palette coordinate.
export function directConstantMultUvCorners(program) {
  const m = directConstantMultUvMatrix(program),
    corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    output = new Uint16Array(8);
  for (let i = 0; i < 4; i++) {
    const [x, y] = corners[i];
    output[i * 2] = directTrailHalf(f(f(f(m[0] * x) + f(m[2] * y)) + m[4]));
    output[i * 2 + 1] = directTrailHalf(f(f(f(m[1] * x) + f(m[3] * y)) + m[5]));
  }
  return output;
}
