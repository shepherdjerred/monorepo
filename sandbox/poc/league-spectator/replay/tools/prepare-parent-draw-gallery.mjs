// Produce controlled WASM component snapshots with original per-draw updates.
// No replay events, scene visibility, NAV resources or GPU handles are inferred.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLatestParentFrames } from "../latest-parent-frames.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import { createLatestNativeParentMaterials } from "../latest-native-parent-materials.mjs";
import { parentFrameUniformBlocks } from "../latest-parent-frame-uniforms.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  directory = `${assets}/latest-parent-draw-caches`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  vector = (floats) => {
    const bytes = new Uint8Array(16),
      view = new DataView(bytes.buffer);
    floats.forEach((v, i) => view.setFloat32(i * 4, v, true));
    return bytes;
  },
  hex = (b) => Buffer.from(b).toString("hex"),
  proofs = await Promise.all(
    [
      "parent-draw-parameters-comparison",
      "parent-draw-parameters-workers",
      "parent-frame-uniforms-comparison",
    ].map((name) => read(`${cache}/research/${name}.json`)),
  ),
  bulkPackageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkPackageBytes)),
  common = {
    profile: await read(`${assets}/decoder-16.21-macos/profile.json`),
    image: await raw(`${assets}/decoder-16.21-macos/image.bin`),
    spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
    abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
    cachePackageBytes: await raw(`${directory}/package.json`),
    mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
    drawParameterBytes: await raw(
      `${assets}/latest-parent-draw-parameters/package.json`,
    ),
  },
  catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes)),
  source = await read(`${cache}/research/parent-draw-parameters-native.json`),
  materials = await createLatestNativeParentMaterials({
    profile: common.profile,
    packageBytes: await raw(
      `${assets}/latest-parent-native-materials/package.json`,
    ),
    effectsManifestBytes: await raw(`${assets}/latest-effects/manifest.json`),
  }),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createLatestBulkUnicorn(
    factory,
    await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
    bulkPackageBytes,
    await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  );
for (const p of proofs) {
  check(
    p.mismatchCount === 0 && p.counts.roots === 14,
    "Full draw/uniform comparisons required",
  );
  for (const [name, digest] of Object.entries(p.sources))
    check(
      sha(await raw(`${root}/${name}`)) === digest,
      `Draw gallery producer changed: ${name}`,
    );
  for (const [path, digest] of Object.entries(p.inputs))
    check(
      sha(await raw(path)) === digest,
      `Draw gallery input changed: ${path}`,
    );
}
const cases = [],
  stages = new Map(),
  counts = {
    roots: 0,
    preparedRoots: 0,
    boundaryRoots: 0,
    geometryFramesCompared: 0,
    drawRecords: 0,
    uniformBlocks: 0,
  };
for (const c of source.cases) {
  const ref = catalog.caches.find((r) => r.effectId === c.effectId),
    runtime = await createLatestParentFrames({
      ...common,
      uc,
      cacheBytes: await raw(`${directory}/${ref.file}`),
      loadBytes: (name) => raw(`${directory}/${name}`),
      loadMathBytes: (name) => raw(`${assets}/latest-parent-math/${name}`),
    });
  const result = { effectId: c.effectId, status: "boundary", frames: [] };
  try {
    const handle = runtime.createParent({
        seed: 9876n,
        clock: { ...c.clockInput, ticks: c.clockInput.ticks.map(BigInt) },
      }),
      initialTime = runtime.ownership(handle).initialTime,
      checkpoint = runtime.checkpoint(),
      baseline = [];
    result.ownership = runtime.ownership(handle);
    for (let tick = 1; tick <= 30; tick++) {
      const frame = runtime.advance(
        handle,
        Math.fround(initialTime + tick / 60),
        20,
      );
      frame.geometry = runtime.render(handle, source.camera);
      frame.tick = tick;
      baseline.push(frame);
    }
    const chosen = baseline.reduce((a, b) =>
        b.geometry.reduce((s, g) => s + g.indicesHex.length, 0) >
        a.geometry.reduce((s, g) => s + g.indicesHex.length, 0)
          ? b
          : a,
      ),
      points = chosen.geometry.flatMap((g) => {
        const b = Buffer.from(g.verticesHex, "hex"),
          v = new DataView(b.buffer, b.byteOffset, b.byteLength),
          p = [];
        for (let at = 0; at < b.length; at += 28)
          p.push([
            v.getFloat32(at, true),
            v.getFloat32(at + 4, true),
            v.getFloat32(at + 8, true),
          ]);
        return p;
      });
    check(points.length > 0, "No original geometry in sampled window");
    const lo = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]))),
      hi = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]))),
      center = lo.map((v, i) => (v + hi[i]) / 2),
      scale = Math.max(hi[0] - lo[0], hi[2] - lo[2], 1) * 0.6,
      zscale = Math.max(hi[1] - lo[1], 1) * 2,
      projectionRows = [
        1 / scale,
        0,
        0,
        -center[0] / scale,
        0,
        0,
        -1 / scale,
        center[2] / scale,
        0,
        -1 / zscale,
        0,
        0.5 + center[1] / zscale,
        0,
        0,
        0,
        1,
      ].map(Math.fround),
      projectionSource = Array.from(
        { length: 16 },
        (_, i) => projectionRows[(i % 4) * 4 + Math.floor(i / 4)],
      ),
      scene = {
        vCamera: vector(source.camera.position),
        FOG_OF_WAR_PARAMS: vector([0, 0, 0.5, 0.5]),
        RENDERTARGET_IS_SRGB: vector([0]),
      };
    runtime.restore(checkpoint);
    for (const expected of baseline.slice(0, chosen.tick)) {
      const actual = runtime.advance(handle, expected.time, 20);
      actual.geometry = runtime.render(handle, source.camera);
      actual.tick = expected.tick;
      check(
        isDeepStrictEqual(actual, expected),
        "Gallery seek changed original state/geometry",
      );
      counts.geometryFramesCompared++;
    }
    const uniformBlocks = {},
      parameters = [];
    for (const actor of runtime.ownership(handle).actors) {
      const rows =
        materials.metadata.roots[c.effectId].actors[actor.emitterIndex].rows;
      check(
        rows.length === 1 && rows[0].variants.length === 1,
        "Gallery requires explicit material/pass variant policy",
      );
      const selected = materials.resolve(
          c.effectId,
          actor.emitterIndex,
          rows[0].hash,
          0,
        ),
        pair = [];
      for (const stage of ["vertex", "pixel"]) {
        const id = selected.variant.shaders[stage].sha256;
        if (!stages.has(id))
          stages.set(
            id,
            await materials.loadShader(id, (name) =>
              raw(`${assets}/latest-shaders/${name}`),
            ),
          );
        pair.push(stages.get(id));
      }
      const parameter = runtime.drawParameters(
          handle,
          actor.emitterIndex,
          { projectionSource, passHash: rows[0].hash, instanceOffset: 0 },
          { binary: true },
        ),
        blocks = parentFrameUniformBlocks(selected, pair, parameter, scene),
        expectedProjection = new Uint8Array(64),
        pv = new DataView(expectedProjection.buffer);
      projectionRows.forEach((v, i) => pv.setFloat32(i * 4, v, true));
      check(
        hex(parameter.values.mProj) === hex(expectedProjection),
        "Original setter did not supply the fitted projection",
      );
      uniformBlocks[actor.emitterIndex] = blocks.map(({ bytes, ...b }) => ({
        ...b,
        bytesHex: hex(bytes),
      }));
      parameters.push({
        ...parameter,
        values: Object.fromEntries(
          Object.entries(parameter.values).map(([k, v]) => [k, hex(v)]),
        ),
      });
    }
    runtime.releaseCheckpoint(checkpoint);
    result.status = "prepared-original-draw-frame";
    result.frames = [{ ...chosen, uniformBlocks, drawParameters: parameters }];
    result.projectionRows = projectionRows;
    counts.preparedRoots++;
  } catch (error) {
    result.error = String(error.message ?? error);
    counts.boundaryRoots++;
  } finally {
    runtime.close();
  }
  cases.push(result);
  counts.roots++;
  console.log(
    JSON.stringify({
      effectId: c.effectId,
      status: result.status,
      error: result.error,
    }),
  );
}
counts.drawRecords = cases
  .filter((c) => c.status === "prepared-original-draw-frame")
  .reduce((sum, c) => sum + c.frames[0].drawParameters.length, 0);
counts.uniformBlocks = cases
  .filter((c) => c.status === "prepared-original-draw-frame")
  .reduce(
    (sum, c) =>
      sum +
      Object.values(c.frames[0].uniformBlocks).reduce(
        (s, b) => s + b.length,
        0,
      ),
    0,
  );
const sources = {};
for (const name of [
  "tools/prepare-parent-draw-gallery.mjs",
  "latest-parent-frames.mjs",
  "latest-parent-draw-parameters.mjs",
  "latest-parent-frame-uniforms.mjs",
  "latest-native-parent-materials.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "wasm-original-parent-draw-gallery-fixture",
  build: source.build,
  protocol: source.protocol,
  inputs,
  sources,
  counts,
  camera: source.camera,
  cases,
  scope: {
    actualWasmParentFrames: true,
    originalDrawPrefixExecuted: true,
    originalParameterBytesPacked: true,
    controlledFittedCamera: true,
    controlledSceneValues: true,
    wholeRootAdmission: true,
    replayPlayback: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-draw-gallery.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts }));
