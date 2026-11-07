import { resolve } from "node:path";
import { createDirectEffectKernels } from "../latest-direct-effect-worker.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_PROGRAM_VERSION,
} from "../latest-direct-effect-runtime.mjs";
import { directParticleBasis } from "../latest-direct-effect-math.mjs";
import {
  directRenderAttributes,
  directGeometryBuffers,
} from "../latest-direct-effect-draw.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { normalizeDirectSystemAudio } from "../latest-direct-effect-audio.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const root = `${cache}/public`,
  inputs = {};
const raw = async (path) => {
  const b = await Bun.file(path).bytes();
  inputs[path] = await sha256(b);
  return b;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const profile = await read(`${root}/decoder-16.21-macos/profile.json`);
for (const file of [
  "latest-direct-effect-runtime.mjs",
  "latest-direct-effect-audio.mjs",
  "latest-direct-effect-position.mjs",
  "latest-direct-effect-world-inputs.mjs",
  "latest-direct-effect-flex.mjs",
  "latest-direct-effect-orientation.mjs",
  "latest-direct-effect-integrated-rotation.mjs",
  "latest-direct-effect-soft.mjs",
  "latest-direct-effect-sprite.mjs",
  "latest-direct-particle-palette.mjs",
  "latest-direct-effect-math.mjs",
  "latest-direct-effect-draw.mjs",
  "latest-direct-effect-worker.mjs",
  "latest-vfx-values.mjs",
  "latest-vfx-birth.mjs",
  "latest-vfx-emission.mjs",
  "tools/inspect-direct-effect-kernels.mjs",
])
  await raw(resolve(import.meta.dir, "..", file));
const packages = Object.fromEntries(
  await Promise.all(
    ["values", "birth", "emission", "samplers"].map(async (name) => [
      name,
      await raw(`${root}/decoder-16.21-macos/vfx-${name}.json`),
    ]),
  ),
);
const kernels = await createDirectEffectKernels({ profile, packages });
const manifestBytes = await raw(`${root}/latest-effects/manifest.json`);
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const contentHash = await sha256(manifestBytes);
const native = await read(`${cache}/research/vfx-point-quads-native.json`);
const metaBytes = await raw(`${root}/decoder-16.21-macos/vfx-point-quads.json`);
const meta = JSON.parse(new TextDecoder().decode(metaBytes));
if (
  native.definitionSha256 !== (await sha256(metaBytes)) ||
  native.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("Stale native point-quad oracle");
let matrices = 0,
  vertices = 0,
  colors = 0,
  indices = 0,
  birthRecords = 0,
  maxPositionError = 0,
  maxBasisError = 0;
const omissions = [],
  mismatches = [],
  comparisons = [];
const floats = (hex) => new Float32Array(Uint8Array.fromHex(hex).buffer);
for (const ref of meta.templates) {
  const defBytes = await raw(
    `${root}/latest-effects/${manifest.definitions[ref.effectId].file}`,
  );
  if ((await sha256(defBytes)) !== ref.sourceDefinitionSha256)
    throw Error("Stale point source definition");
  const sourceDefinition = JSON.parse(
    new TextDecoder().decode(defBytes),
  ).definition;
  const source =
    sourceDefinition.complexEmitterDefinitionData[ref.emitterIndex];
  const cases = native.cases.filter((c) => c.graphSha256 === ref.sha256);
  for (const c of cases) {
    // Compare the rotation port against every recorded native birth, including
    // randomized birth inputs. The comparison supplies the native sampled
    // angles, so it makes no claim about an unported RNG call order.
    for (const frame of c.frames) {
      const output = frame.output.state;
      for (const record of output.births) {
        const b = floats(record.birthHex),
          expected = output.vectors.matrices.count
            ? floats(output.vectors.matrices.hex)
            : null;
        if (
          !expected ||
          output.births.length !== 1 ||
          output.vectors.matrices.count !== 1
        )
          continue;
        const basis = directParticleBasis([...b.subarray(23, 26)]);
        for (let axis = 0; axis < 3; axis++)
          for (let lane = 0; lane < 3; lane++) {
            const error = Math.abs(
              basis[axis][lane] - expected[axis * 4 + lane],
            );
            maxBasisError = Math.max(maxBasisError, error);
            if (error > 1e-6)
              mismatches.push({
                kind: "basis",
                effectId: ref.effectId,
                axis,
                lane,
                error,
              });
          }
        matrices++;
      }
    }
  }
  const c = cases.find((c) => c.mode === 0 && c.seedHex === "0000000000000000");
  if (
    !c ||
    !c.frames[0].output.state.births.length ||
    ![1, 4].includes(source.blendMode)
  ) {
    omissions.push({
      effectId: ref.effectId,
      emitterIndex: ref.emitterIndex,
      reason: ![1, 4].includes(source.blendMode)
        ? `material:blend:${source.blendMode}`
        : "no-native-birth-at-origin",
    });
    continue;
  }
  const frame = c.frames[0],
    sourcePosition = frame.input.current;
  const d = {
    programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
    systemAudio: normalizeDirectSystemAudio(sourceDefinition),
    id: ref.effectId,
    build: manifest.build,
    protocol: manifest.protocol,
    contentHash,
    unsupported: [],
    emitters: [
      {
        index: ref.emitterIndex,
        source,
        placementRequirements: { rootBasis: true, boundObjectSize: null },
        primitive: "arbitrary-quad",
        offset: kernels.birth.pointOffset(source.SpawnShape),
        bound: false,
        delay: 0,
        lifetime: source.lifetime ?? 1,
        single: !!source.isSingleParticle,
        uniformScale: !!source.isUniformScale,
        materialKey: `${ref.effectId}:${ref.emitterIndex}`,
      },
    ],
  };
  const runtime = new LatestDirectEffectRuntime({
    ...d,
    replayHash: "0".repeat(64),
    definitions: new Map([[d.id, d]]),
    events: [
      {
        id: "oracle:0",
        origin: "network-effect",
        kind: "create",
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        entityId: 1,
        definitionId: d.id,
        seedHex: c.seedHex,
      },
    ],
    world: {
      placement: () => ({
        resolved: true,
        position: sourcePosition,
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        boundObjectSize: 0,
        boundObjectSizeStatus: "supplied-native-component-control-zero",
      }),
    },
    kernels,
  });
  runtime.advanceTo(0);
  const packet = runtime.generateDraws({ right: [1, 0, 0], up: [0, 1, 0] });
  const draw = packet.draws[0],
    expected = Uint8Array.fromHex(frame.output.geometry.verticesHex);
  if (!draw || draw.positions.length / 3 !== expected.length / 28) {
    mismatches.push({ kind: "vertex-count", effectId: d.id });
    continue;
  }
  const attrs = directRenderAttributes(draw),
    view = new DataView(expected.buffer);
  for (let i = 0; i < expected.length / 28; i++) {
    for (let lane = 0; lane < 3; lane++) {
      const error = Math.abs(
        attrs.a_POSITION[i * 3 + lane] -
          view.getFloat32(i * 28 + lane * 4, true),
      );
      maxPositionError = Math.max(maxPositionError, error);
      if (error > 0.0001)
        mismatches.push({ kind: "position", effectId: d.id, i, lane, error });
    }
    for (let lane = 0; lane < 4; lane++) {
      if (attrs.a_COLOR[i * 4 + lane] !== expected[i * 28 + 12 + lane])
        mismatches.push({ kind: "color", effectId: d.id, i, lane });
      colors++;
    }
    vertices++;
  }
  const expectedIndex = new Uint16Array(
    Uint8Array.fromHex(frame.output.geometry.indicesHex).buffer,
  );
  for (const [i, index] of expectedIndex.entries()) {
    if (attrs.index[i] !== index)
      mismatches.push({ kind: "index", effectId: d.id, i });
    indices++;
  }
  const nativeBirth = floats(frame.output.state.births[0].birthHex);
  const actual = runtime.checkpoint().instances[0][1].emitters[0];
  if (actual.data[1] !== nativeBirth[51])
    mismatches.push({ kind: "lifetime", effectId: d.id });
  birthRecords++;
  comparisons.push({
    effectId: ref.effectId,
    emitterIndex: ref.emitterIndex,
    shaderKey: `${ref.effectId}:${ref.emitterIndex}`,
    time: 0,
    draws: packet.draws.map((d) => ({
      ...d,
      positions: [...d.positions],
      colors: [...d.colors],
      uv: [...d.uv],
      particleUV: d.particleUV ? [...d.particleUV] : undefined,
      indices: [...d.indices],
    })),
  });
  runtime.advanceTo(0.1);
  const visual = runtime.generateDraws({ right: [1, 0, 0], up: [0, 1, 0] });
  comparisons.at(-1).visual = {
    time: 0.1,
    geometry: visual.draws.map((draw) => {
      const buffers = directGeometryBuffers(draw);
      return {
        verticesHex: buffers.vertices.toHex(),
        indicesHex: buffers.indices.toHex(),
      };
    }),
  };
}
const result = {
  schema: 1,
  kind: "direct-point-quad-native-comparison",
  inputs,
  counts: { matrices, birthRecords, vertices, colors, indices },
  maxBasisError,
  maxPositionError,
  mismatches,
  omissions,
  comparisons,
  scope: {
    suppliedNativeAnglesForMatrixChecks: true,
    deterministicInitialBirthGeometry: true,
    fullNativeParentScheduling: false,
    browserExecuted: false,
    matchCoverage: false,
    originalExternalLibmParity: false,
  },
};
await Bun.write(
  `${cache}/research/direct-effect-kernels.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      counts: result.counts,
      maxBasisError,
      maxPositionError,
      mismatches: mismatches.slice(0, 12),
    },
    null,
    2,
  ),
);
if (mismatches.length)
  throw Error(`${mismatches.length} direct/native kernel mismatches`);
