import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  createLatestDirectRayMaterialPackage,
  isLatestDirectRayMaterialPackage,
} from "../latest-direct-ray-material-package.mjs";
import { directRayScene } from "../latest-direct-ray-scene.mjs";
import { directNativeMetalRasterToGles } from "../latest-native-raster-conventions.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  folder = `${cache}/public/latest-direct-ray-materials`,
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h)
    throw Error("Ray binding source drift");
  inputs[path] = h;
  return b;
}
const read = async (p) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(p)));
await captureDirectSourceInputs([import.meta.path], raw);
const p = await read(`${folder}/package.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  native = await read(`${cache}/research/direct-ray-linked-uv-native.json`);
for (const evidence of [p, native])
  for (const map of [evidence.inputs ?? {}, evidence.sources ?? {}])
    for (const [path, h] of Object.entries(map))
      assert.equal(await sha256(await raw(path)), h, "Ray evidence changed");
const bridge = await createLatestDirectRayMaterialPackage({
  profile,
  packageBytes: await raw(`${folder}/package.json`),
  effectsManifestBytes: manifestBytes,
});
assert.equal(isLatestDirectRayMaterialPackage(bridge), true);
assert.equal(isLatestDirectRayMaterialPackage({ ...bridge }), false);
assert.throws(() => bridge.inspect({}), /Owned/);
const cases = [];
for (const e of bridge.inventory()) {
  const options = {
      effectId: e.effectId,
      emitterIndex: e.emitterIndex,
      passHash: 2700020711,
      variantIndex: 0,
      loadBytes: (p) => raw(`${folder}/${p}`),
    },
    token = await bridge.prepare(options);
  assert.throws(() => bridge.inspect({ ...token }), /Owned/);
  assert.equal(
    (await bridge.prepare({ ...options, passHash: 0 })).status,
    "unavailable-native-material-pass",
  );
  await assert.rejects(
    bridge.prepare({
      ...options,
      loadBytes: async (p) => {
        const b = await raw(`${folder}/${p}`);
        b[0] ^= 1;
        return b;
      },
    }),
    /integrity/,
  );
  const c = native.cases.find(
      (c) => c.effectId === e.effectId && c.emitterIndex === e.emitterIndex,
    ),
    frames = c.frames.filter((f) => f.output.geometry.indicesHex.length > 0);
  assert.ok(frames.length);
  // Retain the source frame; diagnostic projection is explicit and does not alter geometry.
  let chosen,
    peak = -1,
    chosenAxes;
  for (const frame of frames) {
    const v = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      d = new DataView(v.buffer),
      a = Array.from({ length: v.length / 28 }, (_, i) =>
        [0, 1, 2].map((j) => d.getFloat32(i * 28 + j * 4, true)),
      );
    for (const axes of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const ranges = axes.map(
          (j) =>
            Math.max(...a.map((x) => x[j])) - Math.min(...a.map((x) => x[j])),
        ),
        area = ranges[0] * ranges[1];
      if (area > peak) {
        peak = area;
        chosen = frame;
        chosenAxes = axes;
      }
    }
  }
  assert.ok(peak > 0);
  const v = Uint8Array.fromHex(chosen.output.geometry.verticesHex),
    d = new DataView(v.buffer),
    points = Array.from({ length: v.length / 28 }, (_, i) =>
      [0, 1, 2].map((j) => d.getFloat32(i * 28 + j * 4, true)),
    ),
    matrix = new Array(16).fill(0);
  chosenAxes.forEach((axis, row) => {
    const lo = Math.min(...points.map((x) => x[axis])),
      hi = Math.max(...points.map((x) => x[axis])),
      scale = 1.8 / (hi - lo);
    matrix[row * 4 + axis] = scale;
    matrix[row * 4 + 3] = (-(lo + hi) * scale) / 2;
  });
  matrix[15] = 1;
  const scene = directRayScene({
      projectionRows: matrix,
      position: chosen.input.viewPosition,
    }),
    bound = bridge.bind(token, scene);
  assert.equal(bound.status, "bound-explicit-scene-ray-material");
  assert.equal(bound.uniforms.length, 4);
  assert.deepEqual(bridge.frameUniforms(token, scene), bound.uniforms);
  const original = bound.textures[0].levels[0][0][0];
  bound.textures[0].levels[0][0][0] ^= 255;
  assert.equal(bridge.bind(token, scene).textures[0].levels[0][0][0], original);
  const fresh = bridge.bind(token, scene);
  cases.push({
    effectId: e.effectId,
    emitterIndex: e.emitterIndex,
    sourceFrame: { seedHex: c.seedHex, pose: c.pose, time: chosen.input.time },
    geometry: chosen.output.geometry,
    projectionRows: matrix,
    cameraPosition: chosen.input.viewPosition,
    selection: bridge.inspect(token),
    pipeline: fresh.pipeline,
    glesRaster: directNativeMetalRasterToGles(fresh.pipeline, {
      targetViewportOrigin: "lower-left",
      clipY: "unchanged",
    }),
    stages: fresh.stages,
    uniforms: fresh.uniforms.map((b) => ({
      ...b,
      bytes: undefined,
      bytesHex: b.bytes.toHex(),
    })),
    textures: fresh.textures.map((t) => ({
      metadata: t.metadata,
      levels: t.levels.map((l) => l.map((b) => b.toHex())),
    })),
    sceneTextures: Object.fromEntries(
      Object.entries(fresh.sceneTextures).map(([name, t]) => [
        name,
        { ...t, rgba: undefined, rgbaHex: t.rgba.toHex() },
      ]),
    ),
    omissions: fresh.omissions,
    scope: fresh.scope,
  });
}
for (const [path, h] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    h,
    "Final Ray input drift",
  );
const report = {
  schema: 1,
  kind: "owned-ray-factory-bindings",
  inputs,
  cases,
  scope: {
    gpuExecuted: false,
    nativeSceneRecovered: false,
    perFrameGuestCalls: 0,
  },
};
await Bun.write(
  `${cache}/research/direct-ray-bindings.json`,
  JSON.stringify(report),
);
console.log(
  JSON.stringify({
    cases: cases.length,
    inputs: Object.keys(inputs).length,
    output: `${cache}/research/direct-ray-bindings.json`,
  }),
);
