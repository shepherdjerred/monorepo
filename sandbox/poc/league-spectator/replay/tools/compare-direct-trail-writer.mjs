import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  directTrailGeometry,
  directTrailPackedColor,
} from "../latest-direct-effect-trail.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const nativePath = resolve(cache, "research/vfx-trails-native.json");
const sources = [
  nativePath,
  ...[
    "latest-direct-effect-trail.mjs",
    "latest-direct-effect-trail-math.mjs",
    "latest-direct-effect-trail-table.mjs",
    "latest-direct-effect-math.mjs",
    "latest-direct-effect-camera.mjs",
  ].map((name) => resolve(import.meta.dir, "..", name)),
  import.meta.path,
  resolve(cache, "public/decoder-16.21-macos/profile.json"),
  resolve(cache, "public/decoder-16.21-macos/vfx-trails.json"),
  resolve(import.meta.dir, "observe-vfx-trails.py"),
];
const inputBytes = await Promise.all(
  sources.map((path) => Bun.file(path).bytes()),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const native = JSON.parse(new TextDecoder().decode(inputBytes[0]));
const profile = JSON.parse(new TextDecoder().decode(inputBytes.at(-3))),
  definition = JSON.parse(new TextDecoder().decode(inputBytes.at(-2)));
if (
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.definitionSha256 !== sha(inputBytes.at(-2)) ||
  profile.vfxTrailsSha256 !== native.definitionSha256 ||
  definition.writerRva !== 0x1737570 ||
  native.observerSourceSha256 !== sha(inputBytes.at(-1))
)
  throw Error("Exact native trail writer source/image contract differs");
const unpack = (hex) => {
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  return new Float32Array(bytes.buffer);
};
const failures = [];
const colorPath = resolve(cache, "research/direct-blend-color-native.json");
sources.push(colorPath);
inputBytes.push(await Bun.file(colorPath).bytes());
const nativeColor = JSON.parse(new TextDecoder().decode(inputBytes.at(-1)));
if (
  nativeColor.decoderImageSha256 !== profile.decoderImageSha256 ||
  !nativeColor.scope.originalBytePackerExecuted
)
  throw Error("Original trail byte packer evidence differs");
for (const [name, h] of Object.entries(nativeColor.sources)) {
  const path = resolve(import.meta.dir, name),
    raw = await Bun.file(path).bytes();
  if (sha(raw) !== h) throw Error(`Native color producer differs: ${name}`);
  sources.push(path);
  inputBytes.push(raw);
}
for (const [index, c] of nativeColor.controls.entries())
  if (
    JSON.stringify(directTrailPackedColor(c.transformed)) !==
    JSON.stringify(c.packed)
  )
    failures.push({ kind: "packed-color", index });
let cases = 0,
  vertices = 0,
  indices = 0,
  colorBytes = 0,
  halfWords = 0,
  maxPositionError = 0;
for (const [caseIndex, observation] of native.cases.entries()) {
  const source = observation.input;
  if (![0, 1].includes(source.mode)) continue;
  const particle = unpack(source.particleHex),
    positions = new Float32Array(source.count * 3);
  for (let i = 0; i < source.count; i++)
    positions.set(particle.subarray(i * 43 + 32, i * 43 + 35), i * 3);
  const result = directTrailGeometry({
    ...source,
    positions,
    attributes: unpack(source.attributesHex),
    tiling: unpack(source.tilingHex),
    odometer: unpack(source.odometerHex),
  });
  const expected = Buffer.from(observation.verticesHex, "hex"),
    actual = result.vertices;
  const expectedIndices = Buffer.from(observation.indicesHex, "hex"),
    actualIndices = new Uint8Array(
      result.indices.buffer,
      result.indices.byteOffset,
      result.indices.byteLength,
    );
  if (
    expected.length !== actual.length ||
    expectedIndices.length !== actualIndices.length
  ) {
    failures.push({
      caseIndex,
      reason: "output-size",
      actual: actual.length,
      expected: expected.length,
    });
    continue;
  }
  const a = new DataView(actual.buffer, actual.byteOffset, actual.byteLength),
    e = new DataView(expected.buffer, expected.byteOffset, expected.byteLength);
  const mismatch = [];
  for (let i = 0; i < actual.length / 28; i++) {
    for (let lane = 0; lane < 3; lane++) {
      const at = i * 28 + lane * 4,
        error = Math.abs(a.getFloat32(at, true) - e.getFloat32(at, true));
      maxPositionError = Math.max(maxPositionError, error);
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
      if (actual[at] !== expected[at])
        mismatch.push({
          kind: at < i * 28 + 16 ? "color" : "uv",
          at,
          actual: actual[at],
          expected: expected[at],
        });
  }
  if (!Buffer.from(actualIndices).equals(expectedIndices))
    mismatch.push({ kind: "indices" });
  if (mismatch.length)
    failures.push({
      caseIndex,
      mode: source.mode,
      mismatchCount: mismatch.length,
      examples: mismatch.slice(0, 8),
    });
  cases++;
  vertices += actual.length / 28;
  indices += result.indices.length;
  colorBytes += actual.length / 7;
  halfWords += (actual.length / 28) * 6;
}
for (let i = 0; i < sources.length; i++)
  if (sha(await Bun.file(sources[i]).bytes()) !== sha(inputBytes[i]))
    throw Error("Trail writer input changed during comparison");
const report = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  scope:
    "Direct JS CameraTrail writer versus unchanged original native writer supplied-buffer observations; no match simulation, browser or GPU claim",
  inputFingerprints: sources.map((path, i) => ({
    path,
    sha256: sha(inputBytes[i]),
  })),
  inputs: Object.fromEntries(
    sources.map((path, i) => [path, sha(inputBytes[i])]),
  ),
  cases,
  vertices,
  indices,
  colorBytes,
  halfWords,
  packedColorControls: nativeColor.controls.length,
  maxPositionError,
  failures,
};
await Bun.write(
  resolve(cache, "research/direct-trail-writer-comparison.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    cases,
    vertices,
    indices,
    colorBytes,
    halfWords,
    maxPositionError,
    failures: failures.length,
    first: failures[0],
  }),
);
if (failures.length) process.exitCode = 1;
