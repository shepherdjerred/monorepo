import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxTrails,
  trailPreviewMath,
} from "../latest-vfx-trails.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-trails.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  definitionBytes = await Bun.file(`${root}/vfx-trails.json`).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  runtimeBytes = await Bun.file(
    `${vendor}/unicorn_x86_candidate.mjs`,
  ).arrayBuffer(),
  runtime = await Bun.file(`${vendor}/unicorn_x86_candidate.json`).json(),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  decode = (b) => JSON.parse(new TextDecoder().decode(b)),
  definition = decode(definitionBytes),
  native = decode(nativeBytes);
if (
  hash(definitionBytes) !== profile.vfxTrailsSha256 ||
  native.definitionSha256 !== profile.vfxTrailsSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(runtimeBytes) !== runtime.sha256 ||
  runtime.sha256 !== definition.runtimeSha256
)
  throw Error("Trail comparison source mismatch");
const { default: createUnicorn } = await import(
    pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
  ),
  kernel = await createLatestVfxTrails(
    await createUnicorn(),
    profile,
    image,
    definitionBytes,
    trailPreviewMath,
  ),
  hex = (b) => Buffer.from(b).toString("hex"),
  bits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0],
  mismatches = [],
  mathMismatches = [],
  timings = [],
  outputs = [];
let matches = 0,
  vertices = 0,
  indices = 0,
  mathCalls = 0,
  repeatMatches = 0;
function inputFrom(sample) {
  const input = { ...sample.input };
  for (const name of ["particle", "attributes", "tiling", "odometer"])
    input[name + "Bytes"] = new Uint8Array(
      Buffer.from(input[name + "Hex"], "hex"),
    );
  return input;
}
try {
  for (const [index, sample] of native.cases.entries()) {
    const started = performance.now(),
      actual = kernel.build(inputFrom(sample)),
      elapsed = performance.now() - started,
      result = {
        verticesHex: hex(actual.vertices),
        indicesHex: hex(actual.indices),
        drawHex: hex(actual.draw),
      },
      expected = {
        verticesHex: sample.verticesHex,
        indicesHex: sample.indicesHex,
        drawHex: sample.drawHex,
      };
    if (JSON.stringify(result) === JSON.stringify(expected)) matches++;
    else
      mismatches.push({
        index,
        input: {
          count: sample.input.count,
          mode: sample.input.mode,
          smoothingMode: sample.input.smoothingMode,
          smoothingQuality: sample.input.smoothingQuality,
          viewForward: sample.input.viewForward,
          cutoff: sample.input.cutoff,
        },
        actualSha256: hash(JSON.stringify(result)),
        expectedSha256: hash(JSON.stringify(expected)),
        firstDifferentByte: actual.vertices.findIndex(
          (value, at) => value !== Buffer.from(sample.verticesHex, "hex")[at],
        ),
      });
    const signature = (calls) =>
      calls.map((call) => [
        call.name,
        bits(call.a),
        bits(call.b),
        bits(call.result),
      ]);
    if (
      JSON.stringify(signature(actual.mathCalls)) !==
      JSON.stringify(signature(sample.mathCalls))
    )
      mathMismatches.push({
        index,
        actual: signature(actual.mathCalls),
        expected: signature(sample.mathCalls),
      });
    vertices += actual.vertices.length / 28;
    indices += actual.indices.length / 2;
    mathCalls += actual.mathCalls.length;
    timings.push({ count: sample.input.count, elapsedMilliseconds: elapsed });
    outputs.push(result);
  }
  for (const index of [0, 23, native.cases.length - 1, 0]) {
    const actual = kernel.build(inputFrom(native.cases[index])),
      result = {
        verticesHex: hex(actual.vertices),
        indicesHex: hex(actual.indices),
        drawHex: hex(actual.draw),
      };
    if (JSON.stringify(result) !== JSON.stringify(outputs[index]))
      mismatches.push({ kind: "request-order", index });
    else repeatMatches++;
  }
} finally {
  kernel.close();
}
const sources = Object.fromEntries(
  await Promise.all(
    ["latest-vfx-trails.mjs", "native-decoder.mjs"].map(async (name) => [
      name,
      hash(
        await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
      ),
    ]),
  ),
);
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  definitionSha256: hash(definitionBytes),
  nativeEvidenceSha256: hash(nativeBytes),
  observerSourceSha256: native.observerSourceSha256,
  runtimeSha256: runtime.sha256,
  sources,
  cases: native.cases.length,
  matches,
  vertices,
  indices,
  mathCalls,
  repeatMatches,
  mismatches,
  mathMismatches,
  timings,
  executedOriginalBlocks: native.executedOriginalBlocks,
  mathProvider: native.mathProvider,
  wasmMathPolicy: trailPreviewMath.description,
  scope:
    "Actual browser-compatible native trail kernel executed in WASM via CLI on owned buffers. Complete packed vertex/index/draw bytes compared against native Unicorn, whose executed CPU blocks match the pristine client. External math is supplied; original macOS libm, birth/pool ordering, attachment, shaders, browser WebGL and League A/V remain unverified",
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    cases: result.cases,
    matches,
    vertices,
    indices,
    mathCalls,
    repeatMatches,
    mismatches: mismatches.length,
    mathMismatches: mathMismatches.length,
    firstMismatch: mismatches[0],
    firstMathMismatch: mathMismatches[0],
  }),
);
if (mismatches.length || mathMismatches.length) process.exitCode = 1;
