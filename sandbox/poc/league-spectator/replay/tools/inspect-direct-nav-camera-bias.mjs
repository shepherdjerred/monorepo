import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { assertDirectDepthBiasRenderer } from "../latest-direct-effect-depth-bias.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash) throw Error(`Input drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const proof = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/research/direct-nav-camera-renderer-commands-v37.json`),
  ),
);
for (const [path, hash] of Object.entries(proof.inputs))
  assert.equal(await sha256(await raw(path)), hash, path);
const camera = proof.materials["champions/karthus/10/8ad0cea5:7"],
  arbitrary = proof.materials["champions/karthus/10/8ad0cea5:4"];
assert(camera && arbitrary);
assert.equal(camera.actualThreePipeline.polygonOffset, true);
assert.equal(arbitrary.actualThreePipeline.polygonOffset, false);
assert.deepEqual(
  [
    camera.actualThreePipeline.polygonOffsetFactor,
    camera.actualThreePipeline.polygonOffsetUnits,
  ],
  [-1, -12],
);
const source = new TextDecoder().decode(
    await raw(`${cache}/public/vendor/three.module.js`),
  ),
  marker = "function setPolygonOffset( polygonOffset, factor, units )",
  start = source.indexOf(marker);
assert(start >= 0 && source.indexOf(marker, start + 1) < 0);
let end = source.indexOf("{", start),
  depth = 1;
while (depth && ++end < source.length) {
  if (source[end] === "{") depth++;
  else if (source[end] === "}") depth--;
}
assert.equal(depth, 0);
const calls = [],
  enabled = new Set(),
  gl = {
    POLYGON_OFFSET_FILL: 0x8037,
    polygonOffset: (factor, units) =>
      calls.push({ op: "polygonOffset", factor, units }),
  },
  set = new Function(
    "gl",
    "enable",
    "disable",
    "depthBuffer",
    `let currentPolygonOffsetFactor=null,currentPolygonOffsetUnits=null;${source.slice(start, end + 1)};return setPolygonOffset;`,
  )(
    gl,
    (capability) => {
      enabled.add(capability);
      calls.push({ op: "enable", capability });
    },
    (capability) => {
      enabled.delete(capability);
      calls.push({ op: "disable", capability });
    },
    { getReversed: () => false },
  );
const observations = [];
for (const [key, entry] of [
  ["camera", camera],
  ["arbitrary", arbitrary],
  ["camera-restored", camera],
  ["arbitrary-restored", arbitrary],
]) {
  const p = entry.actualThreePipeline;
  set(p.polygonOffset, p.polygonOffsetFactor, p.polygonOffsetUnits);
  assert.equal(enabled.has(gl.POLYGON_OFFSET_FILL), p.polygonOffset);
  observations.push({
    key,
    enabled: enabled.has(gl.POLYGON_OFFSET_FILL),
    calls: structuredClone(calls),
  });
}
assert.equal(calls.filter((c) => c.op === "disable").length, 2);
assert.equal(
  calls.filter((c) => c.op === "polygonOffset").length,
  1,
  "Disabled draws should clear enable state without requiring cached factors to upload zero",
);
let rejected = 0;
for (const renderer of [
  {
    capabilities: { reversedDepthBuffer: true },
    state: { buffers: { depth: { getReversed: () => true } } },
  },
  {
    capabilities: { reversedDepthBuffer: false },
    state: { buffers: { depth: { getReversed: () => true } } },
  },
]) {
  assert.throws(() => assertDirectDepthBiasRenderer(renderer));
  rejected++;
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/direct-nav-camera-bias-control-v37.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "installed-three-navigation-camera-bias-reset-control",
      inputs,
      observations,
      commands: calls,
      reversedDepthRejections: rejected,
      scope: {
        actualRendererMaterialProperties: true,
        exactInstalledThreeRasterFunction: true,
        biasedThenUnbiasedClearsEnable: true,
        actualWebGlContext: false,
        gpuDrawSubmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    transitions: observations.length,
    reversedDepthRejections: rejected,
  }),
);
