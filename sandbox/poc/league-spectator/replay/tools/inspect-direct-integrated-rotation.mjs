import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  compileDirectIntegratedRotation,
  sampleDirectIntegratedRotation,
  applyDirectIntegratedRotation,
} from "../latest-direct-effect-integrated-rotation.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h) throw Error(`Input drift: ${path}`);
  inputs[path] = h;
  return b;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const math = await read(
    `${cache}/research/direct-integrated-rotation-math-native.json`,
  ),
  visual = await read(
    `${cache}/research/direct-integrated-rotation-native.json`,
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Exact instruction image required");
for (const n of [math, visual]) {
  if (
    n.build !== profile.clientVersion ||
    n.protocol !== profile.protocolDigest ||
    n.decoderImageSha256 !== profile.decoderImageSha256 ||
    !n.originalBlocks.length
  )
    throw Error("Exact native rotation build required");
  for (const [path, h] of Object.entries(n.inputs))
    if ((await sha256(await raw(path))) !== h)
      throw Error(`Stale native input: ${path}`);
  for (const [name, h] of Object.entries(n.sources))
    if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== h)
      throw Error(`Stale native source: ${name}`);
  for (const b of n.originalBlocks)
    if ((await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256)
      throw Error("Original instruction bytes differ");
}
if (
  math.kind !== "original-flat-integrated-vector3-rotation-controls" ||
  math.cases.length !== 5 ||
  !math.scope.originalTypedReaderPostloadAndCurveSampler ||
  !math.scope.originalContiguousArithmeticFragment ||
  math.scope.fullParticleControllerExecuted !== false
)
  throw Error("Complete bounded original math controls required");
const hex = (values) => new Uint8Array(new Float32Array(values).buffer).toHex();
let tableScalars = 0,
  queries = 0,
  arithmetic = 0;
const rates = new Set(
  [
    [0, 4, 0],
    [1, -2, 0.5],
    [-5, 0, 2],
    [0, 0, 0],
    [120, -45, 17],
  ].map(JSON.stringify),
);
const fractions = [
  -0.25,
  0,
  1 / 120,
  1 / 63,
  0.1,
  0.25,
  1 / 3,
  0.5,
  0.75,
  0.99,
  1,
  1.25,
].map(Math.fround);
for (const c of math.cases) {
  if (!rates.delete(JSON.stringify(c.rate)))
    throw Error(
      "Distinct positive/negative/zero native rate controls required",
    );
  const value = {
      __type: "IntegratedValueVector3",
      constantValue: [1, 1, 1],
      dynamics: {
        __type: "VfxAnimatedVector3fVariableData",
        times: [0, 1],
        values: [c.rate, c.rate],
      },
    },
    program = compileDirectIntegratedRotation(value);
  if (!program || hex(program.samples) !== c.samplesHex)
    throw Error(`Original integrated table differs: ${JSON.stringify(c.rate)}`);
  if (c.queries.length !== 12 || c.arithmetic.length !== 36)
    throw Error("Exact sample/arithmetic matrix required");
  if (
    JSON.stringify(c.queries.map((q) => q.fraction)) !==
    JSON.stringify(fractions)
  )
    throw Error(
      "Complete native interpolation endpoint/interior/clamp controls required",
    );
  const expectedArithmetic = new Set(
    [0.3, 1, 2.5].flatMap((lifetime) =>
      fractions.map((fraction) =>
        JSON.stringify([Math.fround(lifetime), fraction]),
      ),
    ),
  );
  tableScalars += 192;
  for (const q of c.queries) {
    if (
      hex(sampleDirectIntegratedRotation(program, q.fraction)) !== q.sampleHex
    )
      throw Error("Original integral interpolation differs");
    queries++;
  }
  for (const q of c.arithmetic) {
    if (!expectedArithmetic.delete(JSON.stringify([q.lifetime, q.fraction])))
      throw Error("Distinct lifetime/fraction arithmetic matrix required");
    const integral = Array.from(
      new Float32Array(Uint8Array.fromHex(q.sampleHex).buffer),
    );
    // The original arithmetic fragment receives a sampled integral directly.
    const expected = applyDirectIntegratedRotation(
      q.rotation,
      integral,
      q.lifetime,
    );
    if (hex(expected) !== q.resultHex)
      throw Error("Original rotation arithmetic fragment differs");
    arithmetic++;
  }
  if (expectedArithmetic.size)
    throw Error("Missing native arithmetic controls");
}
if (rates.size) throw Error("Missing native flat-rate controls");
if (
  visual.kind !== "native-bounded-integrated-rotation-quad-controls" ||
  visual.selected.length !== 1 ||
  visual.cases.length !== 8 ||
  visual.registration.offset !== 0x2d1 ||
  visual.registration.mask !== 1 ||
  visual.rotationRegistration.offset !== 0x438
)
  throw Error("Actual full emitter rotation controls required");
if (
  JSON.stringify(math.sourceDefinition.rotation0) !==
  JSON.stringify(visual.selected[0].source.rotation0)
)
  throw Error(
    "Native math and whole-emitter controls use different authored rotation",
  );
const expected = new Set();
for (const seed of ["0000000000000001", "0000000000012345"])
  for (const schedule of ["identity", "seven-bases"])
    for (const variant of ["false", "true"])
      expected.add(JSON.stringify([seed, schedule, variant]));
let frames = 0,
  orientationDifferences = 0;
for (const c of visual.cases) {
  const key = JSON.stringify([c.seedHex, c.schedule, c.variant]);
  if (
    !expected.delete(key) ||
    c.frames.length !== 61 ||
    !c.observedBirths ||
    !c.positiveAreaColoredFrames
  )
    throw Error("Unique positive-geometry61-frame emitter matrix required");
  const disabled = visual.cases.find(
    (v) =>
      v.seedHex === c.seedHex &&
      v.schedule === c.schedule &&
      v.variant === "false",
  );
  for (let i = 0; i < 61; i++) {
    const a = c.frames[i],
      b = disabled.frames[i];
    if (
      a.input.time !== i / 60 ||
      JSON.stringify(a.input) !== JSON.stringify(b.input) ||
      JSON.stringify(a.output.geometry) !== JSON.stringify(b.output.geometry)
    )
      throw Error("Authored Y-only integral changed camera geometry/inputs");
    const rest = (state) => ({
      ...state,
      vectors: Object.fromEntries(
        Object.entries(state.vectors).filter(
          ([k]) => !["matrices", "particle"].includes(k),
        ),
      ),
    });
    if (
      JSON.stringify(rest(a.output.state)) !==
      JSON.stringify(rest(b.output.state))
    )
      throw Error("Rotation enable changed birth/RNG/nonorientation state");
    if (
      JSON.stringify(a.output.state.vectors) !==
      JSON.stringify(b.output.state.vectors)
    )
      orientationDifferences++;
    frames++;
  }
}
if (expected.size || !orientationDifferences)
  throw Error("Missing original enabled orientation control");
for (const name of [
  "inspect-direct-integrated-rotation.mjs",
  "../latest-direct-effect-integrated-rotation.mjs",
])
  await raw(resolve(import.meta.dir, name));
for (const [path, h] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== h)
    throw Error(`Final drift: ${path}`);
const out = {
  schema: 1,
  kind: "verified-flat-integrated-vector3-rotation",
  tableScalars,
  queries,
  arithmetic,
  frames,
  orientationDifferences,
  exactMath: true,
  exactAuthoredCameraGeometry: true,
  inputs,
  scope: {
    standaloneHelperOnly: true,
    compilerAdmissionChanged: false,
    nativeOrientationStreamsRetained: false,
    actualMatchActivated: false,
    gpuSubmitted: false,
  },
};
const output = `${cache}/research/direct-integrated-rotation-comparison.json`;
await Bun.write(output, JSON.stringify(out, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    tableScalars,
    queries,
    arithmetic,
    frames,
    orientationDifferences,
    pass: true,
  }),
);
