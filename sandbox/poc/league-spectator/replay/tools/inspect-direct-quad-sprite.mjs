import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  compileDirectQuadSprite,
  directQuadSpriteFrame,
  directQuadSpriteFrameHalf,
} from "../latest-direct-effect-sprite.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function bytes(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    digest = await sha256(value);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Sprite input drift: ${path}`);
  inputs[path] = digest;
  return value;
}
async function read(path) {
  return JSON.parse(new TextDecoder().decode(await bytes(path)));
}
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
const native = await read(`${cache}/research/direct-quad-sprite-native.json`);
check(
  native.kind === "native-four-frame-random-start-quad-controls" &&
    native.build === "16.21.829.8620" &&
    native.protocol === "20e09df23c66b85e",
  "Exact native sprite observation required",
);
for (const [path, expected] of Object.entries(native.inputs))
  check(
    (await sha256(await bytes(path))) === expected,
    `Native sprite input changed: ${path}`,
  );
for (const [name, expected] of Object.entries(native.sources))
  check(
    (await sha256(await bytes(resolve(import.meta.dir, name)))) === expected,
    `Native sprite producer changed: ${name}`,
  );
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await bytes(`${cache}/public/decoder-16.21-macos/image.bin`);
check(
  (await sha256(image)) === profile.decoderImageSha256 &&
    native.originalBlocks.length > 0,
  "Pinned original sprite instruction image required",
);
for (const block of native.originalBlocks)
  check(
    (await sha256(image.subarray(block.rva, block.rva + block.size))) ===
      block.sha256,
    "Original sprite instruction differs",
  );
const selected = new Map(
  native.selected.map((c) => [`${c.effectId}:${c.emitterIndex}`, c]),
);
check(
  selected.size === 2 && native.selected.length === 2,
  "Exactly two selected native components required",
);
const expected = new Set();
for (const key of selected.keys())
  for (const seed of ["0000000000000001", "0000000000012345"])
    for (const pose of ["identity", "changing"])
      for (const variant of ["authored", "false"])
        expected.add(JSON.stringify([key, seed, pose, variant]));
const seen = new Set();
let frames = 0,
  liveFrames = 0,
  frameLanes = 0,
  scalarCases = 0,
  positiveAreaColoredFrames = 0;
const view = (hex) => new DataView(Uint8Array.fromHex(hex).buffer);
const bits = new DataView(new ArrayBuffer(4));
const floatFromBits = (value) => {
  bits.setUint32(0, value, true);
  return bits.getFloat32(0, true);
};
const floatBits = (value) => {
  bits.setFloat32(0, value, true);
  return bits.getUint32(0, true);
};
for (const c of native.cases) {
  const key = `${c.effectId}:${c.emitterIndex}`,
    caseKey = JSON.stringify([key, c.seedHex, c.pose, c.variant]);
  check(
    expected.has(caseKey) && !seen.has(caseKey),
    "Duplicate/unknown native sprite case",
  );
  seen.add(caseKey);
  check(
    c.frames.length === 31 &&
      c.frames.every((f, tick) => f.input.time === tick / 60),
    "Complete native 31-frame schedule required",
  );
  check(
    c.randomTrace.length === 2 &&
      c.randomTrace[0].rva === 0x175a860 &&
      c.randomTrace[1].rva === 0x175a865,
    "Exactly one final original chance draw per birth required",
  );
  check(
    view(c.randomTrace[0].rngHex).getUint32(8, true) === 0 &&
      view(c.randomTrace[1].rngHex).getUint32(8, true) === 1,
    "Random-start flag must not consume an extra birth draw",
  );
  const chance = floatFromBits(c.randomTrace[1].xmm0LowBits),
    source = {
      ...selected.get(key).source,
      isRandomStartFrame: c.variant === "authored" ? 1 : 0,
    };
  const program = compileDirectQuadSprite(source, "arbitrary-quad");
  check(
    program !== null,
    "Selected native program outside bounded sprite shape",
  );
  const value = directQuadSpriteFrame(program, chance),
    half = directQuadSpriteFrameHalf(program, chance);
  const falseCase = native.cases.find(
    (b) =>
      b.effectId === c.effectId &&
      b.emitterIndex === c.emitterIndex &&
      b.seedHex === c.seedHex &&
      b.pose === c.pose &&
      b.variant === "false",
  );
  let casePositive = 0,
    births = 0;
  for (const [tick, frame] of c.frames.entries()) {
    const state = frame.output.state,
      count = state.vectors.life.count;
    births += state.births.length;
    check(count <= 1, "Bounded authored sprite must have one particle maximum");
    const attributes = view(state.vectors.attributes.hex),
      motion = view(state.vectors.motion.hex),
      vertices = view(frame.output.geometry.verticesHex);
    check(
      vertices.byteLength === count * 4 * 28 &&
        attributes.byteLength === count * 44,
      "Native sprite geometry/pool layout differs",
    );
    if (count) {
      check(
        Object.is(motion.getFloat32(0x1c, true), 0) &&
          Object.is(motion.getFloat32(0x20, true), chance),
        "Native retained frame clock/chance differs",
      );
      check(
        Object.is(attributes.getFloat32(0, true), value),
        "JavaScript sprite frame differs from original controller",
      );
      for (let vertex = 0; vertex < 4; vertex++) {
        check(
          vertices.getUint16(vertex * 28 + 20, true) === half,
          "JavaScript sprite half differs from original packed writer",
        );
        check(
          vertices.getUint16(vertex * 28 + 22, true) === 0,
          "Unimplemented UV W lane encountered",
        );
        frameLanes++;
      }
      const points = Array.from({ length: 4 }, (_, i) =>
        [0, 1, 2].map((lane) => vertices.getFloat32(i * 28 + lane * 4, true)),
      );
      const a = points[1].map((v, i) => v - points[0][i]),
        b = points[3].map((v, i) => v - points[0][i]);
      const cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      check(cross.every(Number.isFinite), "Nonfinite native sprite area");
      if (
        cross.some((v) => v !== 0) &&
        Uint8Array.fromHex(frame.output.geometry.verticesHex)[15] > 0
      )
        casePositive++;
      liveFrames++;
    }
    // Differences are admitted only at the original frame scalar, its packed
    // half lane, and that same _fmodf observation. All other retained state and
    // complete packed geometry must agree with the typed false control.
    const actual = structuredClone(frame.output),
      baseline = falseCase.frames[tick].output;
    if (count) {
      const a = Uint8Array.fromHex(actual.state.vectors.attributes.hex);
      new DataView(a.buffer).setFloat32(0, 0, true);
      actual.state.vectors.attributes.hex = a.toHex();
      const v = Uint8Array.fromHex(actual.geometry.verticesHex);
      for (let i = 0; i < 4; i++)
        new DataView(v.buffer).setUint16(i * 28 + 20, 0, true);
      actual.geometry.verticesHex = v.toHex();
    }
    check(
      actual.state.mathCalls.length === baseline.state.mathCalls.length,
      "Sprite flag changed original math call count",
    );
    actual.state.mathCalls.forEach((call, i) => {
      const original = baseline.state.mathCalls[i];
      if (isDeepStrictEqual(call, original)) return;
      check(
        count === 1 &&
          call.name === "_fmodf" &&
          original.name === "_fmodf" &&
          Object.is(call.x, value) &&
          Object.is(call.result[0], value) &&
          original.x === 0 &&
          original.result[0] === 0,
        "Unexpected original sprite control difference",
      );
      actual.state.mathCalls[i] = structuredClone(original);
    });
    check(
      isDeepStrictEqual(actual, baseline),
      "Random-start flag affected additional particle/RNG/geometry state",
    );
    frames++;
  }
  check(
    births === 1 &&
      casePositive > 0 &&
      c.frames.at(-1).output.state.vectors.life.count === 0,
    "Actual birth, positive geometry and post-death coverage required",
  );
  positiveAreaColoredFrames += casePositive;
}
check(
  seen.size === expected.size,
  "Missing native sprite component/seed/pose/variant case",
);
const expectedScalars = new Set();
for (const variant of ["authored", "false"])
  for (const chance of [0, -0, 0.1, 0.25, 0.3, 0.5, 0.75, 1 - 2 ** -24, 1])
    expectedScalars.add(JSON.stringify([variant, floatBits(chance)]));
const scalarSeen = new Set();
for (const row of native.scalarCases) {
  const key = JSON.stringify([row.variant, row.chanceBits]);
  check(
    expectedScalars.has(key) && !scalarSeen.has(key),
    "Unknown/duplicate scalar sprite case",
  );
  scalarSeen.add(key);
  const program = compileDirectQuadSprite(
      { isRandomStartFrame: row.variant === "authored", numFrames: 4 },
      "arbitrary-quad",
    ),
    chance = floatFromBits(row.chanceBits);
  check(
    row.frameBits === floatBits(directQuadSpriteFrame(program, chance)),
    "Original scalar sprite wrap differs",
  );
  const packed = view(row.packedHalfHex);
  check(
    packed.getUint16(0, true) === directQuadSpriteFrameHalf(program, chance) &&
      [2, 4, 6].every((at) => packed.getUint16(at, true) === 0),
    "Original half rounding/wrap boundary differs",
  );
  check(
    view(row.rngHex).getUint32(8, true) === 0,
    "Frame generation unexpectedly sampled RNG",
  );
  scalarCases++;
}
check(
  scalarSeen.size === expectedScalars.size,
  "Missing scalar sprite edge case",
);
await captureDirectSourceInputs([import.meta.path], bytes);
for (const path of Object.keys(inputs)) await bytes(path);
const result = {
  schema: 1,
  kind: "verified-native-four-frame-random-start-quads",
  inputs,
  counts: {
    components: 2,
    cases: seen.size,
    nativeFrames: frames,
    liveFrames,
    frameLanes,
    scalarCases,
    positiveAreaColoredFrames,
  },
  exactFrameFloat32AndHalf: true,
  retainedStateAndRngUnchangedExceptDeclaredFrame: true,
  scope: {
    suppliedSeedClockMovingRootAndBasis: true,
    fullRuntimeIntegrated: false,
    browserExecuted: false,
    actualMatchActivation: false,
    groundMaterialPrepared: false,
    originalMatchRandomOrderRecovered: false,
  },
};
const output = `${cache}/research/direct-quad-sprite-comparison.json`;
await Bun.write(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, counts: result.counts }));
