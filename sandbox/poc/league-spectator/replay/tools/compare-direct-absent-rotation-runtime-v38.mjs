import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  loadLatestDirectEffectPackage,
  directEmitterMaterialAdmission,
} from "../latest-direct-effect-package.mjs";
import { compileLatestDirectEffect } from "../latest-direct-effect-definition.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import {
  directRenderAttributes,
  directGeometryBuffers,
} from "../latest-direct-effect-draw.mjs";
import { compareDirectQuadUv } from "./direct-quad-uv-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    h = await sha256(bytes);
  if (inputs[path] && inputs[path] !== h) throw Error("Input drift: " + path);
  inputs[path] = h;
  return bytes;
};
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/direct-arbitrary-birth-rotation-native-v38.json`,
);
if (
  native.kind !== "native-arbitrary-birth-rotation-quad-controls-v38" ||
  native.selected.length !== 4 ||
  native.cases.length !== 128
)
  throw Error("Complete bounded quartet/native matrix required");
for (const [path, h] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== h)
    throw Error("Stale native input " + path);
for (const [name, h] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== h)
    throw Error("Stale native source " + name);
const image = await load("decoder-16.21-macos/image.bin");
for (const b of native.originalBlocks)
  if ((await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256)
    throw Error("Native instruction drift");
for (const row of native.selected) {
  if (Object.hasOwn(row.source, "rotation0"))
    throw Error("Native controller must be authored absent");
  for (const variant of ["false", "true"]) {
    const bytes = Uint8Array.fromHex(
      row.rotationPostload[variant].rotationObjectHex,
    );
    if (
      bytes.length !== 24 ||
      bytes.slice(0, 12).some((v) => v !== 0) ||
      bytes.slice(16, 24).some((v) => v !== 0)
    )
      throw Error("Original absent controller constant/curve differs");
  }
}
const id = "champions/akshan/20/d213225a",
  selected = [3, 4, 6, 7],
  manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const originalBytes = await load(
    "latest-effects/" + manifest.definitions[id].file,
  ),
  original = JSON.parse(new TextDecoder().decode(originalBytes));
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: [id],
  captureCompilationInputs: false,
});
for (const index of selected) {
  const e = original.definition.complexEmitterDefinitionData[index];
  if (
    e.isRotationEnabled !== 1 ||
    Object.hasOwn(e, "rotation0") ||
    JSON.stringify(e.birthRotation0?.constantValue) !== "[0,0,90]"
  )
    throw Error("Unchanged actual source quartet required");
}
const d = await compileLatestDirectEffect({
  id,
  definitionBytes: originalBytes,
  manifest,
  manifestBytes,
  kernels: prepared.kernels,
});
const admittedIndices = prepared.definitions
  .get(id)
  .emitters.map((e) => e.index)
  .filter((i) => selected.includes(i));
if (JSON.stringify(admittedIndices) !== JSON.stringify([3, 6, 7]))
  throw Error(
    "Normal owned package conjunction differs: " +
      JSON.stringify(admittedIndices),
  );
const omitted = prepared.definitions
  .get(id)
  .unsupported.find((e) => e.index === 4);
if (
  JSON.stringify(omitted?.reasons) !==
  JSON.stringify(["material:native-constant-mult-pass0-default-atlas-subset"])
)
  throw Error("Non-alpha MULT material omission must remain explicit");
for (const e of d.emitters.filter((e) => selected.includes(e.index))) {
  if (
    e.source.isRotationEnabled !== 1 ||
    Object.hasOwn(e.source, "rotation0") ||
    e.absentRotationControllerProgram?.policy !==
      "native-arbitrary-absent-rotation0-controller-v1"
  )
    throw Error(
      "Actual authored flag/default-controller capability was not retained",
    );
}
const materialChecks = [];
for (const index of selected) {
  const e = d.emitters.find((e) => e.index === index);
  if (!e)
    throw Error(
      "Original source compiler remains unsupported: " +
        JSON.stringify(d.unsupported.find((e) => e.index === index)),
    );
  const admission = directEmitterMaterialAdmission(
    e,
    null,
    prepared.materials,
    prepared.staticMeshPackage,
    prepared.rayPackage,
    prepared.multUvMaterials,
    prepared.navGroundMaterials,
  );
  if (
    admission.reasons.length &&
    (index !== 4 ||
      JSON.stringify(admission.reasons) !==
        JSON.stringify([
          "material:native-constant-mult-pass0-default-atlas-subset",
        ]))
  )
    throw Error("Unexpected actual material gate " + JSON.stringify(admission));
  materialChecks.push({
    index,
    materialKey: e.materialKey,
    mult: !!e.multUvProgram,
    supported: !!admission.material,
    reasons: admission.reasons,
    originalDefinitionSha256: prepared.materials.get(e.materialKey)?.prepared
      .sourceDefinitionSha256,
  });
}
const mismatches = [],
  counts = {
    frames: 0,
    vertices: 0,
    colors: 0,
    uvHalfwords: 0,
    indices: 0,
    rngStates: 0,
    enabledDisabledEqualFrames: 0,
  },
  cases = [];
let maxPositionError = 0;
const expected = new Set(
  selected.flatMap((i) =>
    [1, 0x12345].flatMap((seed) =>
      [
        "identity",
        "yaw90",
        "pitch90",
        "roll45",
        "shear",
        "nonorthogonal",
        "scaled",
        "seven-bases",
      ].flatMap((schedule) =>
        ["false", "true"].map((variant) =>
          JSON.stringify([
            i,
            seed.toString(16).padStart(16, "0"),
            schedule,
            variant,
          ]),
        ),
      ),
    ),
  ),
);
for (const c of native.cases) {
  if (
    c.effectId !== id ||
    !expected.delete(
      JSON.stringify([c.emitterIndex, c.seedHex, c.schedule, c.variant]),
    ) ||
    c.frames.length !== 61
  )
    throw Error("Native cohort mismatch");
  const disabled = native.cases.find(
    (x) =>
      x.emitterIndex === c.emitterIndex &&
      x.seedHex === c.seedHex &&
      x.schedule === c.schedule &&
      x.variant === "false",
  );
  for (let i = 0; i < 61; i++) {
    if (JSON.stringify(c.frames[i]) !== JSON.stringify(disabled.frames[i]))
      throw Error("Native enable bit changes complete comparable state");
    counts.enabledDisabledEqualFrames++;
  }
  if (c.variant === "false") continue;
  const program = d.emitters.find((e) => e.index === c.emitterIndex),
    definition = { ...d, emitters: [program], unsupported: [], blockers: [] };
  const runtime = new LatestDirectEffectRuntime({
    build: native.build,
    protocol: native.protocol,
    contentHash: d.contentHash,
    replayHash: "0".repeat(64),
    definitions: new Map([[id, definition]]),
    kernels: prepared.kernels,
    events: [
      {
        id: "arbitrary-rotation-component-control:0",
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        seedHex: c.seedHex,
      },
    ],
    world: {
      placement: (_event, t) => ({
        resolved: true,
        boundObjectSize: 0,
        boundObjectSizeStatus: "supplied-component-control-zero",
        position: [t * 130, t * 3, t * 70],
        basis: c.frames[Math.min(Math.round(t * 60), 60)].input.basis.filter(
          (_, i) => i < 12 && i % 4 !== 3,
        ),
      }),
    },
  });
  const start = mismatches.length,
    priorCounts = { ...counts };
  for (const frame of c.frames) {
    runtime.advanceTo(frame.input.time);
    const checkpoint = runtime.checkpoint(),
      draw = runtime.generateDraws({
        right: frame.input.cameraRight,
        up: frame.input.cameraUp,
      }).draws[0];
    const oracleDraw =
      draw && program.multUvProgram ? { ...draw, multUV: undefined } : draw;
    const packed = oracleDraw ? directGeometryBuffers(oracleDraw) : null;
    if (
      (packed?.vertices.toHex() ?? "") !== frame.output.geometry.verticesHex ||
      (packed?.indices.toHex() ?? "") !== frame.output.geometry.indicesHex
    )
      mismatches.push({
        index: c.emitterIndex,
        schedule: c.schedule,
        seed: c.seedHex,
        time: frame.input.time,
        kind: "exact-packed-geometry-bytes",
      });
    const actual = oracleDraw ? directRenderAttributes(oracleDraw) : null,
      bytes = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      view = new DataView(bytes.buffer),
      indices = new Uint16Array(
        Uint8Array.fromHex(frame.output.geometry.indicesHex).buffer,
      ),
      context = {
        index: c.emitterIndex,
        schedule: c.schedule,
        seed: c.seedHex,
        time: frame.input.time,
      };
    if (
      (actual?.a_POSITION.length ?? 0) / 3 !== bytes.length / 28 ||
      (actual?.index.length ?? 0) !== indices.length
    )
      mismatches.push({ ...context, kind: "geometry-count" });
    else if (actual) {
      counts.uvHalfwords += compareDirectQuadUv(
        actual,
        bytes,
        context,
        mismatches,
      );
      for (let v = 0; v < bytes.length / 28; v++) {
        for (let lane = 0; lane < 3; lane++) {
          const error = Math.abs(
            actual.a_POSITION[v * 3 + lane] -
              view.getFloat32(v * 28 + lane * 4, true),
          );
          maxPositionError = Math.max(maxPositionError, error);
          if (error !== 0)
            mismatches.push({ ...context, kind: "position", v, lane, error });
        }
        for (let lane = 0; lane < 4; lane++) {
          if (actual.a_COLOR[v * 4 + lane] !== bytes[v * 28 + 12 + lane])
            mismatches.push({ ...context, kind: "color", v, lane });
          counts.colors++;
        }
        counts.vertices++;
      }
      for (let i = 0; i < indices.length; i++) {
        if (actual.index[i] !== indices[i])
          mismatches.push({ ...context, kind: "index", i });
        counts.indices++;
      }
    }
    const rng = new DataView(
        Uint8Array.fromHex(frame.output.state.rngHex).buffer,
      ),
      state = checkpoint.instances[0]?.[1]?.emitters[0]?.random;
    if (state) {
      const draws = rng.getUint32(8, true),
        want =
          draws === 0
            ? BigInt("0x" + c.seedHex) || 1n
            : rng.getBigUint64(0, true);
      if (
        state.draws !== draws ||
        state.stateHex !== want.toString(16).padStart(16, "0")
      )
        mismatches.push({ ...context, kind: "rng" });
      counts.rngStates++;
    }
    counts.frames++;
  }
  cases.push({
    index: c.emitterIndex,
    seed: c.seedHex,
    schedule: c.schedule,
    frames: c.frames.length,
    materialAdmitted: materialChecks.find((m) => m.index === c.emitterIndex)
      .supported,
    mismatches: mismatches.length - start,
    counts: Object.fromEntries(
      Object.entries(counts)
        .filter(([key]) => key !== "enabledDisabledEqualFrames")
        .map(([key, value]) => [key, value - priorCounts[key]]),
    ),
  });
}
if (expected.size) throw Error("Missing native cases");
for (const path of Object.keys(inputs)) await raw(path);
const sumCases = (rows) =>
  rows.reduce((totals, row) => {
    for (const [key, value] of Object.entries(row.counts))
      totals[key] = (totals[key] ?? 0) + value;
    return totals;
  }, {});
const result = {
  schema: 1,
  materialAdmittedGeometryCounts: sumCases(
    cases.filter((c) => c.materialAdmitted),
  ),
  materialOmittedKernelCounts: sumCases(
    cases.filter((c) => !c.materialAdmitted),
  ),
  kind: "actual-compiled-arbitrary-default-rotation-controller-comparison-v38",
  inputs,
  counts,
  cases,
  materialChecks,
  maxPositionError,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 32),
  sourceContract: {
    sourceBytesUnchanged: true,
    authoredEnableFlagRetained: true,
    originalDefinitionSha256: await sha256(originalBytes),
    normalMaterialAdmittedIndices: admittedIndices,
    materialOmittedIndices: [4],
  },
  scope: {
    originalSourceCompiled: true,
    ordinaryPackageCompilation: true,
    realModuleWorkerCompared: false,
    threeMaterialAdmittedGeometryControls: true,
    oneMaterialOmittedKernelControl: true,
    originalRootCurveAbsent: true,
    suppliedRootBasisAndMotion: true,
    actualMissileBasisEstablished: false,
    originalWriterMultiplyTextureAbsent: true,
    fullMultiplyPresentMathEstablishedSeparately: true,
    gpuSubmitted: false,
    actualMatchCoverage: false,
  },
};
const output = `${cache}/research/direct-absent-rotation-runtime-comparison-v38.json`;
await Bun.write(output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      counts,
      maxPositionError,
      mismatchCount: mismatches.length,
      examples: mismatches.slice(0, 3),
    },
    null,
    2,
  ),
);
if (mismatches.length) process.exitCode = 1;
