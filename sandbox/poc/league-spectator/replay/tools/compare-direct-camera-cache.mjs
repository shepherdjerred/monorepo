import { resolve } from "node:path";
import { createDirectCameraCache } from "../latest-direct-effect-camera.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const nativeBytes = await Bun.file(
  `${cache}/research/direct-camera-cache-native.json`,
).bytes();
const native = JSON.parse(new TextDecoder().decode(nativeBytes));
const profile = await Bun.file(
  `${cache}/public/decoder-16.21-macos/profile.json`,
).json();
if (
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion
)
  throw Error("Native camera cache build differs");
for (const [name, hash] of Object.entries(native.sources))
  if (
    (await sha256(await Bun.file(resolve(import.meta.dir, name)).bytes())) !==
    hash
  )
    throw Error(`Camera oracle producer changed: ${name}`);
let lanes = 0,
  exact = 0,
  maxError = 0;
const mismatches = [];
for (const camera of native.cases) {
  const actual = createDirectCameraCache(camera);
  const expected = new Float32Array(Uint8Array.fromHex(camera.cacheHex).buffer);
  if (actual.length !== expected.length)
    throw Error("Camera cache shape differs");
  for (let i = 0; i < actual.length; i++) {
    lanes++;
    if (Object.is(actual[i], expected[i])) exact++;
    const error = Math.abs(actual[i] - expected[i]);
    maxError = Math.max(error, maxError);
    if (error > 1e-7)
      mismatches.push({
        camera: native.cases.indexOf(camera),
        lane: i,
        actual: actual[i],
        expected: expected[i],
        error,
      });
  }
}
const producers = {};
for (const file of [
  "latest-direct-effect-camera.mjs",
  "latest-direct-effect-camera-table.mjs",
  "tools/compare-direct-camera-cache.mjs",
  "tools/prepare-direct-camera-table.py",
])
  producers[file] = await sha256(
    await Bun.file(resolve(import.meta.dir, "..", file)).bytes(),
  );
const result = {
  schema: 1,
  cameras: native.cases.length,
  angles: 360,
  lanes,
  exact,
  maxError,
  mismatches,
  nativeSha256: await sha256(nativeBytes),
  producers,
  scope: native.scope,
};
await Bun.write(
  `${cache}/research/direct-camera-cache-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    ...result,
    producers: undefined,
    mismatches: mismatches.slice(0, 5),
  }),
);
if (mismatches.length) process.exitCode = 1;
