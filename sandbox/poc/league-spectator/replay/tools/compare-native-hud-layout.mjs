import path from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { createLatestNativeHudLayout } from "../latest-native-hud-layout.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [decoderArgument, manifestPath, nativePath, output] =
  process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun compare-native-hud-layout.mjs <decoder-directory> <manifest.json> <native-layout-control.json> <comparison.json>",
  );
const decoder = path.resolve(decoderArgument),
  manifestBytes = await Bun.file(manifestPath).bytes(),
  nativeBytes = await Bun.file(nativePath).bytes(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
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
const { default: createUnicorn } = await import(pathToFileURL(vendorPath).href),
  uc = await createUnicorn(),
  kernel = await createLatestNativeHudLayout({
    uc,
    profile,
    image: await Bun.file(path.join(decoder, "image.bin")).bytes(),
    spawnBytes: await Bun.file(path.join(decoder, "vfx-spawn.json")).bytes(),
    manifestBytes,
    manifestSha256: await sha256(manifestBytes),
  }),
  positions = native.observations.map((item) => item.source.authoredPosition),
  started = performance.now();
let comparisons = 0;
try {
  for (const index of [0, 1, 2, 3, 1, 0]) {
    const [width, height] =
        native.observations[0].results[index].suppliedViewport,
      actual = kernel.layout(positions, width, height);
    for (let row = 0; row < positions.length; row++) {
      assert.deepEqual(
        actual[row],
        native.observations[row].results[index].originalOutputRect,
        `Original HUD rectangle ${row} viewport ${width}x${height}`,
      );
      comparisons++;
    }
  }
  assert.throws(
    () => kernel.layout([{ ...positions[0], inventedScale: 1 }], 1920, 1080),
    /Unbound/,
  );
  assert.throws(() => kernel.layout(positions, 0, 1080), /positive/);
  assert.throws(
    () =>
      kernel.layout(
        [
          {
            ...positions[0],
            Anchors: { __type: "AnchorDouble", anchorLeft: [0, 0] },
          },
        ],
        1920,
        1080,
      ),
    /override/,
  );
} finally {
  kernel.close();
}
assert.throws(() => kernel.layout(positions, 1920, 1080), /Closed/);
const report = {
  schema: 1,
  kind: "original-native-hud-layout-wasm-comparison",
  manifestSha256: await sha256(manifestBytes),
  nativeSha256: await sha256(nativeBytes),
  sourceSha256: await sha256(
    await Bun.file(
      path.join(import.meta.dir, "../latest-native-hud-layout.mjs"),
    ).bytes(),
  ),
  rectangles: positions.length,
  comparisons,
  elapsedMs: performance.now() - started,
  mismatches: [],
  scope:
    "Original authored root-parent/default-settings layout in actual native WASM executor; scene/controller/text and rendered browser HUD remain separate",
};
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    rectangles: positions.length,
    comparisons,
    elapsedMs: report.elapsedMs,
    mismatches: 0,
  }),
);
