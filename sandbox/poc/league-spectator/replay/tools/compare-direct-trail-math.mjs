import { resolve } from "node:path";
import {
  directTrailAngleRadians,
  directTrailSinDegrees,
  directTrailCosDegrees,
  directTrailCorrectMode1,
} from "../latest-direct-effect-trail-math.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  const b = await Bun.file(path).bytes();
  inputs[path] = await sha256(b);
  return b;
};
const native = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/research/direct-trail-math-native.json`),
  ),
);
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Trail math native input changed: ${path}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const range of native.ranges)
  if (
    (await sha256(image.subarray(range.rva, range.rva + range.bytes))) !==
    range.sha256
  )
    throw Error("Trail math original instructions changed");
const hex = (values) => new Uint8Array(new Float32Array(values).buffer).toHex();
const mismatches = [];
for (const [index, c] of native.trig.entries())
  if (
    hex([directTrailSinDegrees(c.angle)]) !== c.sinHex ||
    hex([directTrailCosDegrees(c.angle)]) !== c.cosHex
  )
    mismatches.push({
      kind: "trig",
      index,
      sin: hex([directTrailSinDegrees(c.angle)]),
      cos: hex([directTrailCosDegrees(c.angle)]),
      c,
    });
for (const [index, c] of native.angles.entries())
  if (hex([directTrailAngleRadians(c.a, c.b)]) !== c.angleHex)
    mismatches.push({
      kind: "angle",
      index,
      actual: hex([directTrailAngleRadians(c.a, c.b)]),
      c,
    });
let maxError = 0;
for (const [index, c] of native.joins.entries()) {
  const actual = directTrailCorrectMode1(c),
    expected = new Float32Array(Uint8Array.fromHex(c.offsetHex).buffer);
  for (let lane = 0; lane < 3; lane++) {
    const error = Math.abs(actual[lane] - expected[lane]);
    maxError = Math.max(error, maxError);
    if (error > 1e-6 || !Number.isFinite(actual[lane]))
      mismatches.push({
        kind: "join",
        index,
        lane,
        actual: actual[lane],
        expected: expected[lane],
        error,
      });
  }
}
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "..", "latest-direct-effect-trail-math.mjs"),
  resolve(import.meta.dir, "..", "latest-direct-effect-trail-table.mjs"),
  resolve(import.meta.dir, "..", "latest-direct-effect-camera.mjs"),
])
  await raw(path);
const output = `${cache}/research/direct-trail-math-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "translated-direct-trail-mode1-math-comparison",
      inputs,
      counts: {
        trig: native.trig.length,
        angles: native.angles.length,
        joins: native.joins.length,
      },
      mismatches,
      maxError,
      scope: {
        exactTrigAndAngleBytes: true,
        joinTolerance: 1e-6,
        originalMacosLibmCaptured: false,
        wholeTrailWriter: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    mismatches: mismatches.length,
    maxError,
    examples: mismatches.slice(0, 4),
  }),
);
if (mismatches.length) process.exit(1);
