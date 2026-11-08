import { resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { compileLatestDirectEffect } from "../latest-direct-effect-definition.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const scheduleMode = process.argv.includes("--schedule");
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes(),
    h = await sha256(raw);
  if (inputs[path] && inputs[path] !== h)
    throw Error("Trail comparison input changed");
  inputs[path] = h;
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const load = (path) => bytes(resolve(cache, "public", path));
await captureDirectSourceInputs([import.meta.path], bytes);
const nativePath = scheduleMode
  ? "direct-trail-schedule-native.json"
  : "trail-particles-native.json";
const native = await read(resolve(cache, "research", nativePath));
for (const [path, h] of Object.entries(native.inputs ?? {}))
  if ((await sha256(await bytes(path))) !== h)
    throw Error(`Native trail input differs: ${path}`);
for (const [name, h] of Object.entries(native.sources ?? {}))
  if ((await sha256(await bytes(resolve(import.meta.dir, name)))) !== h)
    throw Error(`Native trail observer differs: ${name}`);
const metadataBytes = await load("latest-trail-particles/package.json"),
  metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
if ((await sha256(metadataBytes)) !== native.packageSha256)
  throw Error("Native trail graph package differs");
for (const [name, h] of Object.entries(metadata.compilerSources))
  if ((await sha256(await bytes(resolve(import.meta.dir, name)))) !== h)
    throw Error(`Native trail producer differs: ${name}`);
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
  "latest-direct-effect-definition.mjs",
  "latest-direct-effect-birth.mjs",
  "latest-direct-effect-draw.mjs",
  "latest-direct-effect-trail.mjs",
  "latest-direct-effect-trail-math.mjs",
  "latest-direct-effect-trail-table.mjs",
  "latest-direct-effect-camera.mjs",
  "latest-direct-effect-math.mjs",
  "tools/compare-direct-trail-schedule.mjs",
])
  await bytes(resolve(import.meta.dir, "..", file));
const manifestBytes = await load("latest-effects/manifest.json");
const candidates = native.cases.filter((c) => c.quality === 0);
// The known regression loads through the same static package path as the
// viewer. Other complete assets below isolate the new primitive; unrelated
// quad/ground components in those roots do not acquire a material implicitly.
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: ["champions/vladimir/39/9fbafd14"],
});
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
for (const id of [...new Set(candidates.map((c) => c.effectId))]) {
  const d = await compileLatestDirectEffect({
    id,
    manifest,
    manifestBytes,
    definitionBytes: await load(
      `latest-effects/${manifest.definitions[id].file}`,
    ),
    kernels: prepared.kernels,
  });
  prepared.definitions.set(id, {
    ...d,
    emitters: d.emitters.filter(
      (e) =>
        e.primitive === "camera-trail" && prepared.materials.has(e.materialKey),
    ),
  });
}
const mismatches = [],
  cases = [],
  omitted = [],
  comparisons = [],
  motionSequences = [];
let frames = 0,
  vertices = 0,
  colors = 0,
  halfWords = 0,
  indices = 0,
  rngStates = 0,
  maxPositionError = 0;
const seen = new Set();
for (const reference of candidates) {
  const d = prepared.definitions.get(reference.effectId),
    program = d.emitters.find(
      (e) =>
        e.index === reference.emitterIndex && e.primitive === "camera-trail",
    );
  if (!program) {
    omitted.push({
      effectId: reference.effectId,
      emitterIndex: reference.emitterIndex,
      reasons: d.unsupported
        .filter((e) => e.index === reference.emitterIndex)
        .flatMap((e) => e.reasons),
    });
    continue;
  }
  const ref = metadata.templates.find(
    (r) =>
      r.effectId === reference.effectId &&
      r.emitterIndex === reference.emitterIndex,
  );
  if (
    !ref ||
    ref.sha256 !== reference.graphSha256 ||
    (await sha256(await load(`latest-trail-particles/${ref.file}`))) !==
      ref.sha256
  )
    throw Error("Native trail graph identity differs");
  const samples = new Map(
    reference.frames.map((frame) => [
      Math.round(frame.input.time * 60),
      frame.input,
    ]),
  );
  const runtime = new LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: "0".repeat(64),
    definitions: new Map([
      [d.id, { ...d, blockers: [], unsupported: [], emitters: [program] }],
    ]),
    kernels: prepared.kernels,
    events: [
      {
        id: "trail-control:0",
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: d.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        seedHex: reference.seedHex,
      },
    ],
    world: {
      placement: (_e, t) => {
        const sample = samples.get(Math.round(t * 60));
        if (!sample) throw Error("Missing exact supplied native world sample");
        return {
          resolved: true,
          boundObjectSize: 0,
          boundObjectSizeStatus: "supplied-native-component-control-zero",
          position: sample.current,
          basis: sample.basis.filter((_, i) => i < 12 && i % 4 !== 3),
        };
      },
    },
  });
  const start = mismatches.length;
  let visual = null;
  const motionFrames = [],
    savedStates = new Map();
  const firstComponent = !seen.has(`${d.id}:${program.index}`);
  for (const [frameIndex, frame] of reference.frames.entries()) {
    runtime.advanceTo(frame.input.time);
    const draw = runtime.generateDraws({
      right: frame.input.cameraRight,
      up: frame.input.cameraUp,
      axis: frame.input.viewAxis,
    }).draws[0];
    const actual = draw
        ? directGeometryBuffers(draw)
        : { vertices: new Uint8Array(), indices: new Uint8Array() },
      expected = Uint8Array.from(
        Buffer.from(frame.output.geometry.verticesHex, "hex"),
      ),
      expectedIndices = Uint8Array.from(
        Buffer.from(frame.output.geometry.indicesHex, "hex"),
      );
    const state = runtime.checkpoint().instances[0]?.[1].emitters[0];
    const nativeState = frame.output.state,
      nativeRng = Buffer.from(nativeState.rngHex, "hex");
    if ((state?.count ?? 0) !== nativeState.vectors.life.count)
      mismatches.push({
        effectId: d.id,
        emitterId: program.index,
        frameIndex,
        kind: "pool-count",
        actual: state?.count ?? 0,
        expected: nativeState.vectors.life.count,
      });
    if (state) {
      const life = Buffer.from(nativeState.vectors.life.hex, "hex"),
        odo = Buffer.from(nativeState.vectors.odometer.hex, "hex"),
        tile = Buffer.from(nativeState.vectors.tiling.hex, "hex"),
        uv = Buffer.from(nativeState.vectors.unknown78.hex, "hex");
      for (let i = 0; i < state.count; i++)
        for (const [field, actualValue, expectedValue] of [
          ["birth-time", state.data[i * 20], life.readFloatLE(i * 8)],
          ["lifetime", state.data[i * 20 + 1], life.readFloatLE(i * 8 + 4)],
          ["odometer", state.trailData[i * 6 + 4], odo.readFloatLE(i * 4)],
          ["tiling-u", state.trailData[i * 6 + 2], tile.readFloatLE(i * 8)],
          ["tiling-v", state.trailData[i * 6 + 3], tile.readFloatLE(i * 8 + 4)],
          ["birth-uv-u", state.trailData[i * 6], uv.readFloatLE(i * 24 + 16)],
          [
            "birth-uv-v",
            state.trailData[i * 6 + 1],
            uv.readFloatLE(i * 24 + 20),
          ],
        ])
          if (actualValue !== expectedValue)
            mismatches.push({
              effectId: d.id,
              emitterId: program.index,
              frameIndex,
              kind: field,
              particle: i,
              actual: actualValue,
              expected: expectedValue,
            });
    }
    if (
      state &&
      (state.random.stateHex !==
        nativeRng.readBigUInt64LE().toString(16).padStart(16, "0") ||
        state.random.draws !== nativeRng.readUInt32LE(8))
    )
      mismatches.push({
        effectId: d.id,
        emitterId: program.index,
        frameIndex,
        kind: "rng",
        actual: state.random,
        expected: nativeState.rngHex,
      });
    if (state) rngStates++;
    const mismatch = [];
    if (
      actual.vertices.length !== expected.length ||
      actual.indices.length !== expectedIndices.length
    )
      mismatch.push({
        kind: "size",
        actual: actual.vertices.length,
        expected: expected.length,
      });
    else {
      const a = new DataView(
          actual.vertices.buffer,
          actual.vertices.byteOffset,
          actual.vertices.byteLength,
        ),
        e = new DataView(
          expected.buffer,
          expected.byteOffset,
          expected.byteLength,
        );
      for (let i = 0; i < actual.vertices.length / 28; i++) {
        for (let lane = 0; lane < 3; lane++) {
          const at = i * 28 + lane * 4,
            error = Math.abs(a.getFloat32(at, true) - e.getFloat32(at, true));
          maxPositionError = Math.max(error, maxPositionError);
          if (error > 0.0001)
            mismatch.push({
              kind: "position",
              vertex: i,
              lane,
              actual: a.getFloat32(at, true),
              expected: e.getFloat32(at, true),
            });
        }
        for (let at = i * 28 + 12; at < i * 28 + 28; at++)
          if (actual.vertices[at] !== expected[at])
            mismatch.push({
              kind: at < i * 28 + 16 ? "color" : "uv",
              at,
              actual: actual.vertices[at],
              expected: expected[at],
            });
      }
      if (!Buffer.from(actual.indices).equals(Buffer.from(expectedIndices)))
        mismatch.push({ kind: "indices" });
    }
    if (mismatch.length)
      mismatches.push({
        effectId: d.id,
        emitterId: program.index,
        frameIndex,
        time: frame.input.time,
        count: mismatch.length,
        examples: mismatch.slice(0, 8),
      });
    savedStates.set(frame.input.time, runtime.checkpoint());
    const geometry = {
      verticesHex: Buffer.from(actual.vertices).toString("hex"),
      indicesHex: Buffer.from(actual.indices).toString("hex"),
    };
    if (
      firstComponent &&
      [0, 6, 12, 24, 36, 48, 60, 72, 90, 120].includes(
        Math.round(frame.input.time * 60),
      ) &&
      !motionFrames.some((f) => f.time === frame.input.time)
    )
      motionFrames.push({ time: frame.input.time, geometry });
    if (!mismatch.length && draw && !seen.has(`${d.id}:${program.index}`)) {
      const score = Math.max(
        ...Array.from(
          { length: actual.vertices.length / 28 },
          (_, i) => actual.vertices[i * 28 + 15],
        ),
      );
      if (score > (visual?.score ?? 0) && draw.particleCount > 1)
        visual = {
          effectId: d.id,
          emitterIndex: program.index,
          visual: { time: frame.input.time, geometry: [geometry] },
          primitiveKind: "camera-trail",
          particleCount: draw.particleCount,
          score,
          camera: {
            right: frame.input.cameraRight,
            up: frame.input.cameraUp,
            axis: frame.input.viewAxis,
          },
        };
    }
    frames++;
    vertices += actual.vertices.length / 28;
    colors += actual.vertices.length / 7;
    halfWords += (actual.vertices.length / 28) * 6;
    indices += actual.indices.length / 2;
  }
  for (const time of [0.1, 0.5, 0.2, 0.5]) {
    if (!savedStates.has(time)) continue;
    runtime.advanceTo(time);
    if (
      JSON.stringify(runtime.checkpoint()) !==
      JSON.stringify(savedStates.get(time))
    )
      throw Error(
        `Trail checkpoint differs after ordered seek: ${d.id}:${program.index}:${time}`,
      );
  }
  if (visual) {
    comparisons.push(visual);
    seen.add(`${d.id}:${program.index}`);
    motionSequences.push({
      effectId: d.id,
      emitterIndex: program.index,
      primitiveKind: "camera-trail",
      camera: visual.camera,
      frames: motionFrames,
    });
  }
  cases.push({
    effectId: d.id,
    emitterIndex: program.index,
    seedHex: reference.seedHex,
    frames: reference.frames.length,
    mismatches: mismatches.length - start,
  });
}
if (!cases.length) throw Error("No compiled CameraTrail components selected");
for (const [path, h] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== h)
    throw Error("Trail comparison source changed during execution");
const report = {
  schema: 1,
  build: prepared.contract.build,
  protocol: prepared.contract.protocol,
  programVersion: [...prepared.definitions.values()][0].programVersion,
  inputs,
  definitions: [...prepared.definitions.values()].map((d) => ({
    id: d.id,
    systemFlags: d.systemFlags,
    systemOmissions: d.systemOmissions,
    blockers: d.blockers,
    unsupported: d.unsupported,
    components: d.emitters.map((e) => ({
      index: e.index,
      primitive: e.primitive,
      omissions: e.omissions,
    })),
  })),
  cases,
  omitted,
  frames,
  vertices,
  colors,
  halfWords,
  indices,
  rngStates,
  counts: { vertices, colors, halfWords, indices, rngStates, frames },
  maxPositionError,
  mismatches,
  comparisons,
  motionSequences,
  scope: {
    originalUnchangedTrailAssets: true,
    suppliedClockPoseSeedAndWorld: true,
    cameraSmoothingQuality: 0,
    originalParentActivation: false,
    actualMatchCoverage: false,
    browserExecuted: false,
    gpuSubmitted: false,
  },
};
await Bun.write(
  resolve(
    cache,
    `research/direct-trail-${scheduleMode ? "schedule" : "asset"}-comparison.json`,
  ),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    components: new Set(cases.map((c) => `${c.effectId}:${c.emitterIndex}`))
      .size,
    cases: cases.length,
    frames,
    vertices,
    colors,
    halfWords,
    indices,
    rngStates,
    maxPositionError,
    mismatches: mismatches.length,
    first: mismatches[0],
    omitted: omitted.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
