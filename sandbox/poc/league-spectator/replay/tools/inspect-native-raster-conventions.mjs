import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { directNativeMetalRasterToGles } from "../latest-native-raster-conventions.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input drift: ${path}`);
  inputs[path] = digest;
  return data;
}
await captureDirectSourceInputs([import.meta.path], raw);
const native = JSON.parse(
    new TextDecoder().decode(
      await raw(`${cache}/research/native-mesh-raster-conventions.json`),
    ),
  ),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(native.kind, "original-metal-raster-api-conventions");
assert.equal(native.build, "16.21.829.8620");
assert.equal(native.protocol, "20e09df23c66b85e");
assert.equal(native.decoderImageSha256, await sha256(image));
assert.equal(native.winding.length, 2);
assert.equal(native.viewports.length, 2);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash);
for (const block of native.originalBlocks)
  assert.equal(
    await sha256(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const seen = new Set(),
  controls = [];
for (const c of native.winding) {
  const bytes = Uint8Array.fromHex(c.descriptorHex),
    raw15 = bytes[15];
  assert([0, 1].includes(raw15) && !seen.has(raw15));
  seen.add(raw15);
  assert.equal(c.raster.winding, Number(raw15 === 0));
  assert.equal(c.raster.cull, 2);
  assert.deepEqual(
    c.messages.map((m) => [m.selector, m.value]),
    [
      ["setCullMode:", 2],
      ["setFrontFacingWinding:", c.raster.winding],
    ],
  );
  assert.deepEqual(
    c.messages.map((m) => m.originalReturnRva),
    [0x192768e, 0x19276b6],
  );
  const result = directNativeMetalRasterToGles(
    {
      descriptorHex: c.descriptorHex,
      state: {
        frontFace: raw15 ? 0x0900 : 0x0901,
        cullFace: 0x0405,
        cullEnabled: true,
      },
    },
    { targetViewportOrigin: "lower-left", clipY: "unchanged" },
  );
  assert.equal(result.native.winding, c.raster.winding);
  assert.equal(result.native.cullMode, c.raster.cull);
  assert.equal(result.state.frontFace, raw15 ? 0x0901 : 0x0900);
  controls.push(result);
}
for (const c of native.viewports) {
  const [x0, y0, x1, y1] = c.inputRectangle;
  assert.equal(c.message.selector, "setViewport:");
  assert.equal(c.message.originalReturnRva, 0x1927325);
  assert.deepEqual(c.message.viewport, [
    x0,
    y0,
    x1 - x0,
    y1 - y0,
    ...c.inputDepth,
  ]);
  assert(c.message.viewport[2] > 0 && c.message.viewport[3] > 0);
}
for (const [path, digest] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), digest);
const output = `${cache}/research/native-raster-conventions-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-metal-to-gles-raster-coordinate-comparison",
      controls,
      viewportControls: native.viewports.length,
      inputs,
      scope: {
        originalDescriptorAndApiMessagesCompared: true,
        oppositeViewportOriginWindingConversion: true,
        cullModeChanged: false,
        actualMetalExecuted: false,
        gpuPixelCoverage: false,
        browserPlayback: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    controls: controls.length,
    viewportControls: native.viewports.length,
    inputs: Object.keys(inputs).length,
  }),
);
