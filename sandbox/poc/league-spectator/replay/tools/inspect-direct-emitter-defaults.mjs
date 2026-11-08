import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { normalizeDirectPointEmitter } from "../latest-direct-effect-defaults.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    hash = await sha256(data);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Emitter default input drift:${path}`);
  inputs[path] = hash;
  return data;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    `${cache}/research/direct-emitter-defaults-native.json`,
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await load("decoder-16.21-macos/image.bin"),
  manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
assert.equal(native.kind, "original-typed-emitter-absent-default-controls");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
assert.equal(await sha256(image), profile.decoderImageSha256);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash, path);
assert(native.originalBlocks.length > 0);
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
const fieldOffset = native.registration.birthScale0.offset;
assert.equal(fieldOffset, 0x3e8);
assert.deepEqual(
  Array.from(
    new Float32Array(
      Uint8Array.fromHex(native.constructorOnly.objectHex).buffer,
      fieldOffset,
      3,
    ),
  ),
  [1, 1, 1],
);
const expected = new Set([
    "champions/gangplank/14/b00ffab6:0",
    "champions/jinx/2/8a5418b7:0",
    "champions/vladimir/39/fe3c9b09:0",
  ]),
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: native.cases.map((c) => c.effectId),
  }),
  counts = {
    components: 0,
    frames: 0,
    vertices: 0,
    colors: 0,
    halfWords: 0,
    indices: 0,
    birthScaleLanes: 0,
    typedExplicitZeroNativeFrames: 0,
  },
  numerical = { tolerance: 0.0001, maxPositionError: 0 },
  mismatches = [];
for (const c of native.cases) {
  assert(expected.delete(`${c.effectId}:${c.emitterIndex}`));
  assert.equal(
    c.sourceDefinitionSha256,
    manifest.definitions[c.effectId].sha256,
  );
  for (const key of ["birthScale0", "particleLifetime", "bindWeight"])
    assert(!Object.hasOwn(c.source, key));
  assert.deepEqual(c.firstBirthScale, [1, 1, 1]);
  assert.deepEqual(c.explicitZero.firstBirthScale, [0, 0, 0]);
  assert.equal(c.explicitZero.frames.length, 3);
  for (const phase of ["before", "after"])
    assert.deepEqual(
      Array.from(
        new Float32Array(
          Uint8Array.fromHex(c.explicitZero[phase].objectHex).buffer,
          fieldOffset,
          3,
        ),
      ),
      [0, 0, 0],
    );
  const typedZero = { __type: "ValueVector3", constantValue: [0, 0, 0] };
  assert.equal(
    normalizeDirectPointEmitter({ ...c.source, birthScale0: typedZero })
      .birthScale0,
    typedZero,
  );
  counts.typedExplicitZeroNativeFrames += c.explicitZero.frames.length;
  assert.equal(c.frames.length, 3);
  const compiled = prepared.definitions.get(c.effectId),
    program = compiled.emitters.find((e) => e.index === c.emitterIndex);
  assert(program);
  assert.deepEqual(program.source.birthScale0, {
    __type: "ValueVector3",
    constantValue: [1, 1, 1],
  });
  const runtime = new LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: "8".repeat(64),
    kernels: prepared.kernels,
    definitions: new Map([
      [
        compiled.id,
        { ...compiled, blockers: [], unsupported: [], emitters: [program] },
      ],
    ]),
    events: [
      {
        id: `defaults:${c.effectId}`,
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: compiled.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        seedHex: "0000000000012345",
      },
    ],
    world: {
      placement: (_e, t) => ({
        resolved: true,
        position: [t * 130, t * 3, t * 70],
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }),
    },
  });
  for (const [tick, frame] of c.frames.entries()) {
    runtime.advanceTo(frame.input.time);
    const before = runtime.checkpoint(),
      draw = runtime.generateDraws({
        right: frame.input.cameraRight,
        up: frame.input.cameraUp,
      }).draws[0];
    assert.deepEqual(runtime.checkpoint(), before);
    assert(draw);
    const actual = directGeometryBuffers(draw),
      v = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      ix = Uint8Array.fromHex(frame.output.geometry.indicesHex),
      a = new DataView(
        actual.vertices.buffer,
        actual.vertices.byteOffset,
        actual.vertices.byteLength,
      ),
      e = new DataView(v.buffer);
    assert.equal(actual.vertices.length, v.length);
    assert.equal(actual.indices.length, ix.length);
    for (let at = 0; at < v.length; at += 28) {
      for (let lane = 0; lane < 3; lane++) {
        const error = Math.abs(
          a.getFloat32(at + lane * 4, true) - e.getFloat32(at + lane * 4, true),
        );
        numerical.maxPositionError = Math.max(
          numerical.maxPositionError,
          error,
        );
        if (!Number.isFinite(error) || error > numerical.tolerance)
          mismatches.push({
            effectId: c.effectId,
            tick,
            kind: "position",
            at,
            lane,
            error,
          });
      }
      for (let lane = 12; lane < 16; lane++) {
        if (a.getUint8(at + lane) !== e.getUint8(at + lane))
          mismatches.push({
            effectId: c.effectId,
            tick,
            kind: "color",
            at,
            lane,
          });
        counts.colors++;
      }
      for (let lane = 16; lane < 28; lane += 2) {
        if (a.getUint16(at + lane, true) !== e.getUint16(at + lane, true))
          mismatches.push({
            effectId: c.effectId,
            tick,
            kind: "half-uv",
            at,
            lane,
          });
        counts.halfWords++;
      }
      counts.vertices++;
    }
    assert.deepEqual(actual.indices, ix);
    counts.indices += ix.length / 2;
    const emitter = before.instances[0][1].emitters[0],
      motion = new Float32Array(
        Uint8Array.fromHex(frame.output.state.vectors.motion.hex).buffer,
      );
    assert.equal(emitter.count, frame.output.state.vectors.life.count);
    for (let i = 0; i < emitter.count; i++)
      for (let lane = 0; lane < 3; lane++) {
        assert.equal(emitter.data[i * 20 + 9 + lane], motion[i * 9 + 4 + lane]);
        counts.birthScaleLanes++;
      }
    counts.frames++;
  }
  counts.components++;
}
assert.equal(expected.size, 0);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/direct-emitter-defaults-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "compiled-absent-emitter-defaults-native-differential",
      inputs,
      counts,
      numerical,
      mismatches,
      scope: {
        unchangedActualSourceFields: true,
        originalTypedReaderPostloadAndBirth: true,
        isolatedActivationControl: true,
        fullIndexedCameraGeometry: true,
        allSixPackedUvLanes: true,
        wholeDefinitionActivation: false,
        nativeWorldAcceptance: null,
        gpuSubmitted: false,
        browserPlayback: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output, counts, numerical, mismatches: mismatches.length }),
);
if (mismatches.length) process.exitCode = 1;
