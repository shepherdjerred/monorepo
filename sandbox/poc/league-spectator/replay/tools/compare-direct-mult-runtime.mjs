// Complete source/compiler/material/runtime/packed geometry comparison against
// original typed controls. Supplied clocks/world inputs do not prove a match.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { normalizeDirectPointEmitter } from "../latest-direct-effect-defaults.mjs";
import {
  LatestDirectEffectRuntime,
  directDrawTransfers,
} from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { projectDirectEmitterControl } from "./direct-emitter-control-projection.mjs";
import { directDiagnosticDraw } from "./direct-diagnostic-draw.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Multiply-runtime input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  load = (p) => raw(`${cache}/public/${p}`);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-mult-uv-native.json`),
  comparison = await read(`${cache}/research/direct-mult-uv-comparison.json`);
for (const proof of [native, comparison])
  for (const [path, hash] of Object.entries(proof.inputs))
    assert.equal(await sha256(await raw(path)), hash, path);
assert.equal(comparison.mismatches.length, 0);
const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: comparison.selected.map((r) => r.effectId),
  }),
  counts = {
    cases: 0,
    frames: 0,
    vertices: 0,
    packedHalfLanes: 0,
    colorBytes: 0,
    indices: 0,
    poolLanes: 0,
    rngStates: 0,
    pauseChecks: 0,
    repeatedSeeks: 0,
    clockChecks: 0,
    fallbackFrames: 0,
    transferChecks: 0,
  },
  mismatches = [];
let maxPositionError = 0,
  maxPoolError = 0;
const floats = (v) =>
  new Float32Array(
    Uint8Array.fromHex(typeof v === "string" ? v : v.hex).buffer,
  );
function number(a, e, context, kind) {
  const error = Math.abs(a - e);
  if (kind === "position") maxPositionError = Math.max(maxPositionError, error);
  else maxPoolError = Math.max(maxPoolError, error);
  if (!Number.isFinite(error) || error > 0.0001)
    mismatches.push({ ...context, kind, actual: a, expected: e, error });
}
function geometry(actual, expected, context) {
  const ev = Uint8Array.fromHex(expected.verticesHex),
    ei = Uint8Array.fromHex(expected.indicesHex);
  if (
    actual.vertices.length !== ev.length ||
    actual.indices.length !== ei.length
  ) {
    mismatches.push({ ...context, kind: "geometry-length" });
    return;
  }
  const av = new DataView(
      actual.vertices.buffer,
      actual.vertices.byteOffset,
      actual.vertices.byteLength,
    ),
    v = new DataView(ev.buffer);
  for (let at = 0; at < ev.length; at += 28) {
    counts.vertices++;
    for (let lane = 0; lane < 3; lane++)
      number(
        av.getFloat32(at + lane * 4, true),
        v.getFloat32(at + lane * 4, true),
        { ...context, vertex: at / 28, lane },
        "position",
      );
    for (let lane = 12; lane < 16; lane++) {
      assert.equal(av.getUint8(at + lane), v.getUint8(at + lane));
      counts.colorBytes++;
    }
    for (let lane = 16; lane < 28; lane += 2) {
      assert.equal(
        av.getUint16(at + lane, true),
        v.getUint16(at + lane, true),
        JSON.stringify({ ...context, at, lane }),
      );
      counts.packedHalfLanes++;
    }
  }
  assert.deepEqual(actual.indices, ei);
  counts.indices += ei.length / 2;
}
for (const selected of comparison.selected) {
  const d = prepared.definitions.get(selected.effectId),
    e = d.emitters.find((e) => e.index === selected.emitterIndex);
  assert.ok(
    e?.multUvProgram,
    `Actual compiled/admitted multiply emitter required: ${selected.effectId}:${selected.emitterIndex}`,
  );
  const source = native.selected.find(
    (s) =>
      s.effectId === selected.effectId &&
      s.emitterIndex === selected.emitterIndex,
  );
  assert.deepEqual(e.source, normalizeDirectPointEmitter(source.source));
  const isolated = projectDirectEmitterControl(d, e);
  for (const c of native.cases.filter(
    (c) =>
      c.effectId === selected.effectId &&
      c.emitterIndex === selected.emitterIndex &&
      c.multTexturePresent,
  )) {
    const absent = native.cases.find(
        (a) =>
          a.effectId === c.effectId &&
          a.emitterIndex === c.emitterIndex &&
          !a.multTexturePresent &&
          a.seedHex === c.seedHex &&
          a.pose === c.pose,
      ),
      inputAt = (time) =>
        c.frames[
          Math.min(c.frames.length - 1, Math.max(0, Math.round(time * 60)))
        ].input,
      camera = (time) => ({
        right: inputAt(time).cameraRight,
        up: inputAt(time).cameraUp,
        position: inputAt(time).viewPosition,
      }),
      create = () =>
        new LatestDirectEffectRuntime({
          ...prepared.contract,
          replayHash: "a".repeat(64),
          definitions: new Map([[d.id, isolated]]),
          kernels: prepared.kernels,
          events: [
            {
              id: "mult-control:0",
              kind: "create",
              origin: "animation",
              entityId: 1,
              definitionId: d.id,
              time: 0,
              transportSequence: 0,
              entryOrder: 0,
              seedHex: c.seedHex,
            },
          ],
          world: {
            placement: (_event, time) => ({
              resolved: true,
              position: inputAt(time).current,
              basis: inputAt(time).basis.filter(
                (_, i) => i < 12 && i % 4 !== 3,
              ),
            }),
          },
          checkpointSeconds: 0.125,
          maximumCheckpoints: 32,
        }),
      runtime = create(),
      fast = create();
    for (const [tick, frame] of c.frames.entries()) {
      runtime.advanceTo(frame.input.time);
      const state = runtime.checkpoint(),
        packet = runtime.generateDraws(camera(frame.input.time)),
        draw = packet.draws[0],
        actual = draw
          ? directGeometryBuffers(draw)
          : { vertices: new Uint8Array(), indices: new Uint8Array() },
        context = {
          id: d.id,
          emitter: e.index,
          pose: c.pose,
          seed: c.seedHex,
          tick,
        };
      assert.deepEqual(runtime.checkpoint(), state);
      counts.pauseChecks++;
      geometry(actual, frame.output.geometry, context);
      // The optional stream is absent for the original texture-absent writer;
      // simulation is identical, and age/palette fallback stays byte exact.
      geometry(
        draw ? directGeometryBuffers({ ...draw, multUV: undefined }) : actual,
        absent.frames[tick].output.geometry,
        { ...context, fallback: true },
      );
      counts.fallbackFrames++;
      if (draw) {
        const exported = directDiagnosticDraw(draw);
        assert.equal(
          exported.geometry.verticesHex,
          Buffer.from(actual.vertices).toString("hex"),
        );
        assert.deepEqual(exported.multUV, [...draw.multUV]);
        assert.ok(directDrawTransfers(packet).includes(draw.multUV.buffer));
        assert.equal(draw.multUV.byteLength, 16);
        counts.transferChecks++;
      }
      const n = frame.output.state.vectors.life.count,
        pool = state.instances[0]?.[1].emitters[0];
      assert.equal(pool?.count ?? 0, n);
      if (pool) {
        const life = floats(frame.output.state.vectors.life),
          motion = floats(frame.output.state.vectors.motion),
          initial = floats(frame.output.state.vectors.initial);
        for (let i = 0; i < n; i++)
          for (const [lane, value] of [
            [0, life[i * 2]],
            [1, life[i * 2 + 1]],
            ...[0, 1, 2, 3].map((j) => [5 + j, motion[i * 9 + j]]),
            ...[0, 1, 2].map((j) => [9 + j, motion[i * 9 + 4 + j]]),
            ...[0, 1, 2].map((j) => [12 + j, initial[i * 28 + 12 + j]]),
            [18, motion[i * 9 + 8]],
          ]) {
            number(
              pool.data[i * 20 + lane],
              value,
              { ...context, i, lane },
              "pool",
            );
            counts.poolLanes++;
          }
        const rng = new DataView(
            Uint8Array.fromHex(frame.output.state.rngHex).buffer,
          ),
          draws = rng.getUint32(8, true);
        assert.equal(pool.random.draws, draws);
        assert.equal(
          pool.random.stateHex,
          (draws ? rng.getBigUint64(0, true) : BigInt(`0x${c.seedHex}`))
            .toString(16)
            .padStart(16, "0"),
        );
        counts.rngStates++;
      }
      counts.frames++;
    }
    const terminal = runtime.checkpoint();
    for (let tick = 0; tick < c.frames.length; tick += 4)
      fast.advanceTo(c.frames[tick].input.time);
    fast.advanceTo(c.frames.at(-1).input.time);
    assert.deepEqual(fast.checkpoint(), terminal);
    counts.clockChecks++;
    for (let repeat = 0; repeat < 2; repeat++) {
      runtime.advanceTo(0);
      runtime.advanceTo(c.frames.at(-1).input.time);
      assert.deepEqual(runtime.checkpoint(), terminal);
      counts.repeatedSeeks++;
    }
    counts.cases++;
  }
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final input drift: ${path}`,
  );
const output = `${cache}/research/direct-mult-runtime-comparison.json`,
  result = {
    schema: 1,
    kind: "original-complete-multiply-compiled-runtime-comparison",
    inputs,
    counts,
    maxPositionError,
    maxPoolError,
    tolerance: 0.0001,
    mismatches,
    scope: {
      actualCompilerMaterialAdmissionAndRuntime: true,
      completeTypedOriginalSources: true,
      exactPackedUvColorsAndIndices: true,
      textureAbsentFallbackVerified: true,
      seedsAndWorldInputsSupplied: true,
      nativeMatchAcceptance: null,
      browserAcceptance: false,
      gpuDrawsSubmitted: false,
    },
  };
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts,
    maxPositionError,
    maxPoolError,
    mismatches: mismatches.length,
    inputs: Object.keys(inputs).length,
  }),
);
if (mismatches.length) process.exitCode = 1;
