// Retained birth/motion + already-sampled shared curves -> original Ray inputs.
// No RNG, curve resampling, resources, simulation, camera or placement inference.
import {
  directParticleBasis,
  directParticleWorldBasis,
  directParticleWorldVector,
} from "./latest-direct-effect-math.mjs";
import { directQuadSpriteFrame } from "./latest-direct-effect-sprite.mjs";
const f = Math.fround;
function vector(value, length, label) {
  if (
    !(Array.isArray(value) || value instanceof Float32Array) ||
    value.length !== length ||
    !Array.from(value).every((v) => Number.isFinite(v) && Number.isFinite(f(v)))
  )
    throw Error(`Explicit Ray ${label} required`);
  return Array.from(value, f);
}
export function directRayRetainedParticle({
  birthBasis,
  birthOrigin,
  motion,
  rootPosition,
  bound,
  rotation,
  birthScale,
  sampledScale,
  birthColor,
  sampledColor,
  fraction,
  chance,
  rayProgram,
}) {
  const basis = vector(birthBasis, 9, "birth basis"),
    origin = vector(birthOrigin, 3, "birth origin"),
    local = directParticleWorldVector(vector(motion, 3, "local motion"), basis),
    root = vector(rootPosition, 3, "root position"),
    axes = directParticleWorldBasis(
      directParticleBasis(vector(rotation, 3, "rotation")),
      basis,
    ),
    scale = vector(birthScale, 3, "birth scale"),
    scaleCurve = vector(sampledScale, 3, "sampled scale"),
    color = vector(birthColor, 4, "birth color"),
    colorCurve = vector(sampledColor, 4, "sampled color");
  if (
    typeof bound !== "boolean" ||
    !Number.isFinite(fraction) ||
    !Number.isFinite(f(fraction)) ||
    fraction < 0 ||
    fraction > 1
  )
    throw Error("Explicit Ray binding and normalized age required");
  return {
    position: Float32Array.from(origin, (v, lane) =>
      f((bound ? root[lane] : 0) + f(v + local[lane])),
    ),
    axis: Float32Array.from(axes[2]),
    attributes: Float32Array.from([
      directQuadSpriteFrame(rayProgram, chance),
      ...color.map((v, lane) => f(v * colorCurve[lane])),
      ...scale.map((v, lane) => f(v * scaleCurve[lane])),
      f(fraction),
      1,
      0,
    ]),
  };
}
