import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
import { directStaticMeshResourceFields } from "../latest-direct-effect-mesh.mjs";
import { directStaticMeshRetainedDraw } from "../latest-direct-effect-static-mesh-draw.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  f = Math.fround;
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h) throw Error("Mesh draw input drift");
  inputs[path] = h;
  return b;
}
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  bytes = (h) => new Uint8Array(Buffer.from(h, "hex")),
  floats = (h) => {
    const b = bytes(h),
      v = new DataView(b.buffer);
    return Array.from({ length: b.length / 4 }, (_, i) =>
      v.getFloat32(i * 4, true),
    );
  };
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-mesh-record-native.json`),
  lookup = await read(`${cache}/research/direct-mesh-lookup-native.json`),
  geometry = await read(`${cache}/research/direct-mesh-geometry-native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  valuesBytes = await raw(
    `${cache}/public/decoder-16.21-macos/vfx-values.json`,
  ),
  values = createLatestVfxValues(
    JSON.parse(new TextDecoder().decode(valuesBytes)),
  );
if (
  (await sha256(image)) !== profile.decoderImageSha256 ||
  (await sha256(valuesBytes)) !== profile.vfxValuesSha256 ||
  native.kind !== "original-static-mesh-cpu-record-controls" ||
  native.cases.length !== 16 ||
  lookup.kind !== "original-individual-mesh-color-lookup-packing" ||
  lookup.cases.length !== 16 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest
)
  throw Error("Exact original mesh draw controls required");
for (const evidence of [native, lookup, geometry]) {
  for (const [p, h] of Object.entries(evidence.inputs))
    if ((await sha256(await raw(p))) !== h)
      throw Error(`Stale native mesh input:${p}`);
  for (const b of evidence.originalBlocks ?? [evidence.originalBlock])
    if ((await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256)
      throw Error("Original mesh block changed");
}
const manifest = await read(`${cache}/public/latest-effects/manifest.json`),
  ref = manifest.definitions[native.effectId],
  definitionRaw = await raw(`${cache}/public/latest-effects/${ref.file}`),
  source = JSON.parse(new TextDecoder().decode(definitionRaw)).definition
    .complexEmitterDefinitionData[native.emitterIndex],
  resourceFields = directStaticMeshResourceFields(
    bytes(geometry.mesh.resourceHeaderHex),
  );
if (
  (await sha256(definitionRaw)) !== ref.sha256 ||
  source.bindWeight.constantValue !== 1 ||
  source.birthVelocity !== undefined ||
  source.birthRotation0 !== undefined ||
  source.EmitterPosition !== undefined ||
  JSON.stringify(source.uvScale.constantValue) !== "[2,1]"
)
  throw Error("Native fullsource fixture contract changed");
const key = (c) => `${c.seedHex}:${c.pose}:${c.uvMode}`,
  expected = new Set();
for (const seed of ["0000000000000001", "0000000000012345"])
  for (const pose of ["identity", "yaw90", "pitch90", "shear"])
    for (const uv of ["unbound", "original-authored-uv"])
      expected.add(`${seed}:${pose}:${uv}`);
const lookupCases = new Map(lookup.cases.map((c) => [key(c), c]));
if (lookupCases.size !== 16) throw Error("Duplicate original lookup controls");
const mismatches = [],
  counts = {
    frames: 0,
    particles: 0,
    particleMatrixBytes: 0,
    attributeBytes: 0,
    matrixBytes: 0,
    recordBytes: 0,
    parameterBytes: 0,
  };
function compare(actual, hex, label, counter) {
  const a =
      actual instanceof Uint8Array
        ? actual
        : new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength),
    e = bytes(hex);
  if (a.length !== e.length) throw Error(`Mesh draw output shape:${label}`);
  counts[counter] += e.length;
  for (let i = 0; i < e.length; i++)
    if (a[i] !== e[i])
      mismatches.push({ label, byte: i, actual: a[i], expected: e[i] });
}
for (const c of native.cases) {
  if (!expected.delete(key(c)) || c.frames.length !== 31)
    throw Error("Incomplete/duplicate original mesh source matrix");
  const lc = lookupCases.get(key(c));
  if (!lc || lc.frames.length !== 31)
    throw Error("Missing original lookup cohort");
  const birthBasis = c.frames[0].input.basis.filter(
    (_, i) => i < 12 && i % 4 !== 3,
  );
  for (const [tick, frame] of c.frames.entries()) {
    counts.frames++;
    const state = frame.output.state,
      g = frame.output.geometry,
      life = floats(state.vectors.life.hex),
      motion = floats(state.vectors.motion.hex),
      initial = bytes(state.vectors.initial.hex),
      particles = bytes(state.vectors.particle.hex);
    if (
      state.vectors.life.count !== g.sourceParticleCount ||
      initial.some((x) => x !== 0)
    )
      throw Error("Unproven retained initial mesh state");
    for (let i = 0; i < g.sourceParticleCount; i++) {
      counts.particles++;
      const age = f(f(frame.input.time) - life[i * 2]),
        fraction = f(age / life[i * 2 + 1]),
        recordInputs = g.recordInputs[i],
        uvScale = source.uvScale.constantValue,
        output = directStaticMeshRetainedDraw({
          birthBasis,
          birthOrigin: [0, 0, 0],
          motion: [0, 0, 0],
          rootPosition: frame.input.current,
          bound: true,
          rotation: values.sample(source.birthRotation0, 0, [0, 0, 0]),
          birthScale: motion.slice(i * 9 + 4, i * 9 + 7),
          sampledScale: values.sample(source.scale0, fraction, [1, 1, 1]),
          birthColor: motion.slice(i * 9, i * 9 + 4),
          sampledColor: values.sample(source.Color, fraction, [1, 1, 1, 1]),
          fraction,
          uniformScale: !!source.isUniformScale,
          systemScale: g.systemScale,
          resourceFields,
          definitionColor: source.modulationFactor ?? [1, 1, 1, 1],
          textureDivisions: source.texDiv ?? [1, 1],
          blendByte: source.blendMode ?? 0,
          particleIndex: i,
          linkedUvMatrices:
            c.uvMode === "unbound"
              ? [null, null]
              : [
                  [
                    uvScale[0],
                    0,
                    0,
                    uvScale[1],
                    f((1 - uvScale[0]) / 2),
                    f((1 - uvScale[1]) / 2),
                  ],
                  null,
                ],
        }),
        label = `${key(c)}:${tick}:${i}`;
      // These native matrices/attributes are EXPECTATIONS only. Neither is an
      // input to the new retained-state helper or its transform/record helpers.
      compare(
        output.particleMatrix,
        Buffer.from(particles.subarray(i * 172 + 80, i * 172 + 144)).toString(
          "hex",
        ),
        label,
        "particleMatrixBytes",
      );
      compare(
        output.attributes,
        recordInputs.attributesHex,
        label,
        "attributeBytes",
      );
      compare(output.matrix, g.matrixHex[i], label, "matrixBytes");
      compare(output.record, g.record176Hex[i], label, "recordBytes");
      for (const [name, field] of [
        ["mWorld", "mWorldHex"],
        ["kColorFactor", "kColorFactorHex"],
        ["vParticleUVTransform", "vParticleUVTransformHex"],
        ["DYNAMIC_MESH_CENTER", "dynamicMeshCenterHex"],
      ])
        compare(
          output.parameters[name],
          g.drawInputs[i][field],
          `${label}:${name}`,
          "parameterBytes",
        );
      compare(
        output.parameters.COLOR_LOOKUP_UV,
        lc.frames[tick].lookupHex[i],
        `${label}:COLOR_LOOKUP_UV`,
        "parameterBytes",
      );
    }
  }
}
if (expected.size || counts.frames !== 496 || !counts.particles)
  throw Error("Nonempty complete original mesh cohort required");
for (const [p, h] of Object.entries(inputs))
  if ((await sha256(await Bun.file(p).bytes())) !== h)
    throw Error("Final mesh draw provenance drift");
const output = `${cache}/research/direct-static-mesh-draw-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "retained-particle-static-mesh-draw-differential",
      inputs,
      counts,
      mismatches,
      scope: {
        completeOriginalMeshEmitterFrames: true,
        rotationBasisConstructedBySharedQuadMath: true,
        curvesSampledByExistingVerifiedValueKernel: true,
        nativeParticleMatrixOrAttributesUsedAsInput: false,
        retainedBirthColorScaleFromNativePool: true,
        boundRootNoOffsetZeroMotionFixture: true,
        original176ByteRecordAndFiveNamedParameters: true,
        nonzeroRotationFullMeshSchedule: false,
        productionMeshAdmission: false,
        nativeWorldAcceptance: null,
        gpuSubmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    counts,
    mismatches: mismatches.slice(0, 15),
    mismatchCount: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
