import { resolve } from "node:path";
import {
  directTrailCorrectMode1,
  directTrailAngleRadians,
  directTrailSinDegrees,
  directTrailCosDegrees,
} from "../latest-direct-effect-trail-math.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  native = await Bun.file(
    `${cache}/research/direct-trail-joins-native.json`,
  ).json();
const f = Math.fround,
  hex = (v) => new Uint8Array(new Float32Array(v).buffer).toHex();
const failures = [],
  angles = [],
  trig = [];
let maxError = 0;
for (const [index, c] of native.joins.entries()) {
  const actual = directTrailCorrectMode1(c),
    expected = new Float32Array(Uint8Array.fromHex(c.offsetHex).buffer);
  const error = Math.max(...actual.map((n, i) => Math.abs(n - expected[i])));
  maxError = Math.max(error, maxError);
  if (
    c.angleRadians !== undefined &&
    hex([directTrailAngleRadians(c.previousOffset, c.currentOffset)]) !==
      hex([c.angleRadians])
  )
    angles.push({
      index,
      actual: directTrailAngleRadians(c.previousOffset, c.currentOffset),
      expected: c.angleRadians,
      c,
    });
  if (
    c.rotationDegrees !== undefined &&
    (hex([directTrailSinDegrees(c.rotationDegrees)]) !== hex([c.sin]) ||
      hex([directTrailCosDegrees(c.rotationDegrees)]) !== hex([c.cos]))
  )
    trig.push({ index, c });
  if (error > 1e-6)
    failures.push({ index, error, actual, expected: [...expected], c });
}
console.log(
  JSON.stringify(
    {
      joins: native.joins.length,
      failures: failures.length,
      maxError,
      angles: angles.length,
      trig: trig.length,
      first: failures.slice(0, 2),
      angleFirst: angles.slice(0, 2),
    },
    null,
    2,
  ),
);
