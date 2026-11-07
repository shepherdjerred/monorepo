// Shared retained-particle -> ordinary individual mesh draw handoff. Callers
// sample admitted curves with the existing value kernels; this owns no RNG,
// simulation, resource lookup, provider, or shader/material admission.
import {
  directParticleBasis,
  directParticleWorldBasis,
  directParticleWorldVector,
} from "./latest-direct-effect-math.mjs";
import { directStaticMeshParticleMatrix } from "./latest-direct-effect-mesh.mjs";
import {
  directStaticMeshCpuRecord,
  directStaticMeshDrawParameters,
} from "./latest-direct-effect-mesh-record.mjs";
const f = Math.fround;
function vector(value, length, label) {
  if (
    !(Array.isArray(value) || value instanceof Float32Array) ||
    value.length !== length ||
    !Array.from(value).every((v) => Number.isFinite(v) && Number.isFinite(f(v)))
  )
    throw Error(`Explicit mesh ${label} required`);
  return Array.from(value, f);
}

export function directStaticMeshRetainedDraw({
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
  uniformScale,
  systemScale,
  resourceFields,
  definitionColor,
  textureDivisions,
  blendByte,
  particleIndex,
  linkedUvMatrices,
}) {
  const basis = vector(birthBasis, 9, "retained birth basis"),
    origin = vector(birthOrigin, 3, "retained birth origin"),
    local = directParticleWorldVector(
      vector(motion, 3, "retained local motion"),
      basis,
    ),
    root = vector(rootPosition, 3, "current root position"),
    axes = directParticleWorldBasis(
      directParticleBasis(vector(rotation, 3, "sampled rotation")),
      basis,
    ),
    scale = vector(birthScale, 3, "birth scale"),
    scaleCurve = vector(sampledScale, 3, "sampled scale"),
    color = vector(birthColor, 4, "birth color"),
    colorCurve = vector(sampledColor, 4, "sampled color");
  if (
    typeof bound !== "boolean" ||
    typeof uniformScale !== "boolean" ||
    !Number.isFinite(fraction) ||
    !Number.isFinite(f(fraction)) ||
    fraction < 0 ||
    fraction > 1 ||
    !Array.isArray(linkedUvMatrices) ||
    linkedUvMatrices.length !== 2 ||
    ![0, 1].every((i) => Object.hasOwn(linkedUvMatrices, i))
  )
    throw Error(
      "Explicit admitted mesh particle flags, age and UV providers required",
    );
  const particleMatrix = new Float32Array(16);
  for (let axis = 0; axis < 3; axis++) particleMatrix.set(axes[axis], axis * 4);
  for (let lane = 0; lane < 3; lane++)
    particleMatrix[12 + lane] = f(
      (bound ? root[lane] : 0) + f(origin[lane] + local[lane]),
    );
  particleMatrix[15] = 1;
  const attributes = new Uint8Array(44),
    view = new DataView(attributes.buffer),
    sampled = [
      0,
      ...color.map((v, lane) => f(v * colorCurve[lane])),
      ...scale.map((v, lane) => f(v * scaleCurve[lane])),
      f(fraction),
      1,
      0,
    ];
  sampled.forEach((v, lane) => view.setFloat32(lane * 4, v, true));
  const matrix = directStaticMeshParticleMatrix({
    particleMatrix,
    scale: sampled.slice(5, 8),
    uniformScale,
    systemScale,
    resourceFields,
  });
  const record = directStaticMeshCpuRecord({
    matrix,
    attributes,
    definitionColor,
    textureDivisions,
    blendByte,
    paletteByte: 0,
    particleIndex,
    facingFlags: [false, false, false],
    linkedUvFlags: linkedUvMatrices.map((v) => v !== null),
    linkedUvMatrices,
  });
  return {
    particleMatrix,
    attributes,
    matrix,
    record,
    parameters: directStaticMeshDrawParameters({
      record,
      resourceOffset40: resourceFields.offset40,
      paletteByte: 0,
      multTexturePresent: false,
    }),
  };
}
