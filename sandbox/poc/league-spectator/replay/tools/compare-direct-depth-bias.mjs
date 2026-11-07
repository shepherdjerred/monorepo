import { resolve } from "node:path";
import {
  compileDirectDepthBiasProgram,
  validateDirectDepthBiasProgram,
  assertDirectDepthBiasRenderer,
} from "../latest-direct-effect-depth-bias.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Depth bias input drift");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/direct-depth-bias-native-v35.json`,
);
if (
  native.kind !== "original-emitter-depth-bias-typed-raster-controls" ||
  native.build !== "16.21.829.8620" ||
  native.cases.length !== 9
)
  throw Error("Complete original depth-bias cohort required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Native input changed: " + path);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original depth-bias code changed");
const vendorBytes = await raw(`${cache}/public/vendor/three.module.js`),
  vendor = new TextDecoder().decode(vendorBytes);
const start = vendor.indexOf(
  "function setPolygonOffset( polygonOffset, factor, units )",
);
if (
  start < 0 ||
  vendor.indexOf(
    "function setPolygonOffset( polygonOffset, factor, units )",
    start + 1,
  ) >= 0
)
  throw Error("Unique installed THREE raster function required");
let end = vendor.indexOf("{", start),
  depth = 1;
while (depth && ++end < vendor.length) {
  if (vendor[end] === "{") depth++;
  else if (vendor[end] === "}") depth--;
}
const functionSource = vendor.slice(start, end + 1);
const commands = [],
  gl = {
    POLYGON_OFFSET_FILL: 0x8037,
    polygonOffset: (slope, constant) =>
      commands.push({
        op: "polygonOffset",
        slopeHex: hex(slope),
        constantHex: hex(constant),
      }),
  };
function hex(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes.toHex();
}
const set = new Function(
  "gl",
  "enable",
  "disable",
  "depthBuffer",
  `let currentPolygonOffsetFactor=null,currentPolygonOffsetUnits=null;${functionSource};return setPolygonOffset;`,
)(
  gl,
  () => commands.push({ op: "enable" }),
  () => commands.push({ op: "disable" }),
  { getReversed: () => false },
);
assertDirectDepthBiasRenderer({
  capabilities: { reversedDepthBuffer: false },
  state: { buffers: { depth: { getReversed: () => false } } },
});
let passes = 0;
const cases = [];
for (const [index, c] of native.cases.entries()) {
  const bytes = Uint8Array.fromHex(c.factorHex),
    view = new DataView(bytes.buffer),
    source = {
      depthBiasFactors: [view.getFloat32(0, true), view.getFloat32(4, true)],
    },
    program = compileDirectDepthBiasProgram(source, "camera-quad");
  if (c.passes.length !== 7) throw Error("All native passes required");
  for (const p of c.passes) {
    validateDirectDepthBiasProgram(
      program,
      source,
      "camera-quad",
      p.nativeRenderStateHex,
    );
    passes++;
  }
  const begin = commands.length;
  set(program.enabled, program.slope, program.constant);
  set(false, 0, 0);
  set(program.enabled, program.slope, program.constant);
  const stream = commands.slice(begin);
  if (!stream.some((row) => row.op === "disable"))
    throw Error("Unbiased draw did not clear effective offset");
  cases.push({
    index,
    factorHex: c.factorHex,
    program,
    programFactorHex: hex(program.slope) + hex(program.constant),
    commands: stream,
  });
}
let rejections = 0;
const actual = cases[0],
  source = { depthBiasFactors: [-1, -60] };
for (const call of [
  () =>
    validateDirectDepthBiasProgram(
      { ...actual.program, constant: -12 },
      source,
      "camera-quad",
    ),
  () =>
    validateDirectDepthBiasProgram(
      actual.program,
      source,
      "camera-quad",
      native.cases[1].passes[0].nativeRenderStateHex,
    ),
  () =>
    assertDirectDepthBiasRenderer({
      capabilities: { reversedDepthBuffer: true },
    }),
]) {
  try {
    call();
  } catch {
    rejections++;
  }
}
if (rejections !== 3)
  throw Error("Source/material/reversed depth guards required");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Depth-bias comparison drift");
const output = `${cache}/research/direct-depth-bias-comparison-v35.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "shared-depth-bias-original-raster-and-installed-three-comparison",
      artifactVersion: 35,
      inputs,
      cases,
      passes,
      rejections,
      installedFunctionSha256: await sha256(
        new TextEncoder().encode(functionSource),
      ),
      commands,
      scope: {
        nativeRasterBytesExact: true,
        installedThreeFunctionExecuted: true,
        biasedUnbiasedRestoredState: true,
        sceneOcclusionCompared: false,
        leaguePixelParityEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    passes,
    rejections,
    commands: commands.length,
  }),
);
