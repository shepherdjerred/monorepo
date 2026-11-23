import path from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { createLatestNativeHudAuthoredUv } from "../latest-native-hud-authored-uv.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [decoderArgument, manifestPath, nativePath, inputsPath, output] =
  process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun compare-native-hud-authored-uv.mjs <decoder-directory> <manifest.json> <native-uv-controls.json> <authored-inputs.json> <comparison.json>",
  );
const decoder = path.resolve(decoderArgument),
  manifestBytes = await Bun.file(manifestPath).bytes(),
  nativeBytes = await Bun.file(nativePath).bytes(),
  inputBytes = await Bun.file(inputsPath).bytes(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  inputs = JSON.parse(new TextDecoder().decode(inputBytes)),
  profile = await Bun.file(path.join(decoder, "profile.json")).json(),
  vendorPath = path.join(
    path.dirname(decoder),
    "vendor/unicorn_x86_candidate.mjs",
  ),
  vendor = await Bun.file(vendorPath).bytes();
assert.equal(
  await sha256(vendor),
  "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
);
assert.equal(
  JSON.parse(new TextDecoder().decode(manifestBytes)).nativeObservation.sha256,
  await sha256(nativeBytes),
);
assert.equal(native.inputsSha256, await sha256(inputBytes));
const { default: createUnicorn } = await import(pathToFileURL(vendorPath).href),
  uc = await createUnicorn(),
  kernel = await createLatestNativeHudAuthoredUv({
    uc,
    profile,
    image: await Bun.file(path.join(decoder, "image.bin")).bytes(),
    spawnBytes: await Bun.file(path.join(decoder, "vfx-spawn.json")).bytes(),
    manifestBytes,
    manifestSha256: await sha256(manifestBytes),
  });
const started = performance.now();
let comparisons = 0;
try {
  for (const expected of native.observations) {
    const input = inputs.providers[expected.inputIndex];
    for (const control of expected.cases) {
      const actual = kernel.sample(input.original, {
        width: input.image.width,
        height: input.image.height,
        controlFlags: control.controlFlags,
      });
      assert.equal(
        Buffer.from(actual.bytes).toString("hex"),
        control.uvHex,
        `Original HUD authored UV bytes ${expected.inputIndex}/${control.controlFlags}`,
      );
      assert.deepEqual(actual.values, control.uvF32);
      comparisons++;
    }
  }
  const input = inputs.providers[native.observations[0].inputIndex],
    options = {
      width: input.image.width,
      height: input.image.height,
      controlFlags: 0,
    };
  assert.throws(
    () => kernel.sample({ ...input.original, guessedCrop: 1 }, options),
    /Explicit supported/,
  );
  assert.throws(
    () => kernel.sample(input.original, { ...options, controlFlags: 1 }),
    /Explicit supported/,
  );
  assert.throws(
    () =>
      kernel.sample({ ...input.original, mTextureUV: [NaN, 0, 1, 1] }, options),
    /vector/,
  );
} finally {
  kernel.close();
}
assert.throws(() => kernel.sample({}, {}), /Closed/);
const report = {
  schema: 1,
  kind: "original-native-hud-authored-uv-wasm-comparison",
  manifestSha256: await sha256(manifestBytes),
  nativeSha256: await sha256(nativeBytes),
  inputsSha256: await sha256(inputBytes),
  sourceSha256: await sha256(
    await Bun.file(
      path.join(import.meta.dir, "../latest-native-hud-authored-uv.mjs"),
    ).bytes(),
  ),
  providers: native.observations.length,
  comparisons,
  elapsedMs: performance.now() - started,
  mismatches: [],
  scope:
    "Original authored AtlasData UV program in the actual native WASM executor; explicit zero/flip controls; runtime flags/nested atlas/sliced providers/controller/text/rendered HUD remain separate",
};
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    providers: report.providers,
    comparisons,
    elapsedMs: report.elapsedMs,
    mismatches: 0,
  }),
);
