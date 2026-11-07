// Inspect the actual renderer's attribute/UBO adapters and emit offscreen inputs.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-replay-particle-gpu.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`;
const bundle = await Bun.build({
  entrypoints: [`${root}/latest-vfx-bound-renderer.mjs`],
  target: "bun",
  write: false,
  plugins: [
    {
      name: "pinned-three",
      setup(build) {
        build.onResolve({ filter: /^three$/ }, () => ({
          path: `${assets}/vendor/three.module.js`,
        }));
      },
    },
  ],
  external: ["/assets/*"],
});
if (!bundle.success || bundle.outputs.length !== 1)
  throw Error("Pinned renderer adapter bundle failed");
const bundlePath = `${cache}/research/bound-vfx-renderer.bundle.mjs`;
await Bun.write(bundlePath, bundle.outputs[0]);
const {
  replayQuadAttributes,
  writeReplayCameraBlocks,
  createReplayUniformBlock,
} = await import(pathToFileURL(bundlePath).href);
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  sources = {};
const bytes = async (path) => {
  const data = new Uint8Array(await Bun.file(path).arrayBuffer());
  sources[path] = sha(data);
  return data;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const playback = await read(`${cache}/research/bound-vfx-playback.json`),
  native = await read(`${cache}/research/bound-vfx-playback-native.json`),
  gpu = await read(`${assets}/latest-replay-particles/package.json`);
if (
  native.playbackSha256 !==
    sources[`${cache}/research/bound-vfx-playback.json`] ||
  native.counts.mismatches !== 0 ||
  native.mismatches.length ||
  gpu.quadPackageSha256 !== playback.runtime.definitionSha256 ||
  gpu.build !== playback.build ||
  gpu.counts.emitters !== 7
)
  throw Error("Incomplete native replay composition or GPU preparation");
for (const source of [playback.sources, native.sources])
  for (const [name, expected] of Object.entries(source))
    if (sha(await bytes(`${root}/${name}`)) !== expected)
      throw Error(`Stale replay source: ${name}`);
for (const [path, expected] of Object.entries(gpu.sources))
  if (sha(await bytes(path)) !== expected)
    throw Error(`Stale GPU preparation input: ${path}`);
for (const name of [
  "latest-vfx-bound-renderer.mjs",
  "latest-viewer.mjs",
  "tools/observe-bound-vfx-playback.py",
  "tools/inspect-bound-vfx-playback.mjs",
  "tools/prepare-replay-particles.mjs",
])
  await bytes(`${root}/${name}`);
await bytes(`${assets}/vendor/three.module.js`);
await bytes(`${assets}/vendor/three.core.js`);
await bytes(bundlePath);
let attributeChecks = 0;
for (const sample of playback.samples) {
  if (!sample.geometry) continue;
  const original = Buffer.from(sample.geometry.verticesHex, "hex"),
    attributes = replayQuadAttributes(sample.geometry),
    rebuilt = new Uint8Array(112),
    view = new DataView(rebuilt.buffer);
  for (let vertex = 0; vertex < 4; vertex++) {
    for (let lane = 0; lane < 3; lane++)
      view.setFloat32(
        vertex * 28 + lane * 4,
        attributes.a_POSITION[vertex * 3 + lane],
        true,
      );
    rebuilt.set(
      attributes.a_COLOR.subarray(vertex * 4, vertex * 4 + 4),
      vertex * 28 + 12,
    );
    for (let lane = 0; lane < 4; lane++)
      view.setUint16(
        vertex * 28 + 16 + lane * 2,
        attributes.a_TEXCOORD[vertex * 4 + lane],
        true,
      );
    for (let lane = 0; lane < 2; lane++)
      view.setUint16(
        vertex * 28 + 24 + lane * 2,
        attributes.a_TEXCOORD1[vertex * 2 + lane],
        true,
      );
  }
  if (
    sha(original) !== sha(rebuilt) ||
    Buffer.from(attributes.index.buffer).toString("hex") !==
      sample.geometry.indicesHex
  )
    throw Error(
      "THREE attribute adapter changed native packed vertex/index bits",
    );
  attributeChecks++;
}
const captures = playback.drawsByTime,
  positions = captures.flatMap((capture) =>
    capture.draws.flatMap((draw) => draw.positions),
  );
const minimum = [0, 2].map((axis) =>
    Math.min(...positions.map((v) => v[axis])),
  ),
  maximum = [0, 2].map((axis) => Math.max(...positions.map((v) => v[axis])));
const center = minimum.map((n, i) => (n + maximum[i]) / 2),
  extent = Math.max(...maximum.map((n, i) => (n - minimum[i]) / 2)) * 1.15;
if (!(extent > 0)) throw Error("Degenerate replay diagnostic camera bounds");
const rows = [
  1 / extent,
  0,
  0,
  -center[0] / extent,
  0,
  0,
  1 / extent,
  -center[1] / extent,
  0,
  0,
  0,
  0.5,
  0,
  0,
  0,
  1,
];
const renderFrames = [];
let uniformByteChecks = 0;
for (const capture of captures) {
  const draws = [];
  for (const draw of capture.draws) {
    const prepared = gpu.emitters.find(
      (entry) =>
        entry.effectId === draw.effectId && entry.emitterIndex === draw.emitter,
    );
    if (!prepared || prepared.graphSha256 !== draw.graphSha256)
      throw Error("Replay material/geometry graph changed");
    const blocks = prepared.blocks.map(createReplayUniformBlock);
    for (const block of blocks) {
      const expected = Buffer.from(block.bytesHex, "hex");
      if (
        block.group.name !== block.glslName ||
        block.group.uniforms.length !== 1 ||
        block.group.uniforms[0].value !== block.data ||
        sha(new Uint8Array(block.data.buffer)) !== sha(expected)
      )
        throw Error("THREE std140 adapter changed prepared bytes");
      uniformByteChecks += expected.length;
    }
    writeReplayCameraBlocks(blocks, rows, playback.camera.position);
    const uniformValues = {},
      stagePaths = [];
    for (const stage of ["vertex", "pixel"]) {
      const ref = prepared.shaders[stage],
        path = `${assets}/latest-shaders/${ref.file}`,
        shader = await read(path);
      if (sources[path] !== ref.sha256) throw Error("Replay shader changed");
      stagePaths.push({ path, sha256: ref.sha256 });
      for (const block of shader.sidecar.blocks) {
        const supplied = blocks.find((b) => b.glslName === block.glslName);
        if (!supplied) throw Error("GPU constant buffer not supplied");
        const data = new DataView(supplied.data.buffer);
        for (const member of block.members)
          if (member.used) {
            const value = Array.from(
              { length: member.size / 4 },
              (_, index) => {
                const at = member.offset + index * 4;
                if (member.scalar === "float") return data.getFloat32(at, true);
                if (member.scalar === "uint" || member.scalar === "bool")
                  return data.getUint32(at, true);
                if (member.scalar === "int") return data.getInt32(at, true);
                throw Error("Unimplemented GPU uniform scalar");
              },
            );
            uniformValues[block.glslName + "." + member.name] = value;
          }
      }
    }
    draws.push({
      effectId: draw.effectId,
      emitterIndex: draw.emitter,
      graphSha256: draw.graphSha256,
      materialName: `NativeReplayQuad_${draw.emitter}`,
      geometry: draw.nativeGeometry,
      shaders: stagePaths,
      uniformValues,
      uniformBuffers: blocks.map((block) => ({
        name: block.glslName,
        bytesHex: Buffer.from(block.data.buffer).toString("hex"),
      })),
      textures: prepared.textures,
      nativeBlendFactors: prepared.nativeBlendFactors,
      suppliedSortPass: prepared.suppliedSortPass,
    });
    blocks.forEach((block) => block.group.dispose());
  }
  draws.sort((a, b) => a.suppliedSortPass - b.suppliedSortPass);
  renderFrames.push({ time: capture.time, draws });
}
const result = {
  schema: 1,
  kind: "replay-particle-renderer-input-inspection",
  build: gpu.build,
  protocol: gpu.protocol,
  sources,
  inspectorSha256: sha(await bytes(import.meta.path)),
  gpuPackageSha256: sources[`${assets}/latest-replay-particles/package.json`],
  counts: {
    attributeChecks,
    attributeBytes: attributeChecks * 124,
    uniformByteChecks,
    frames: renderFrames.length,
    drawCalls: renderFrames.reduce((sum, frame) => sum + frame.draws.length, 0),
  },
  camera: { ...playback.camera, diagnosticProjectionRows: rows },
  frames: renderFrames,
  scope: {
    actualRendererAttributeAndUniformAdapters: true,
    nativePackedBitsUnchanged: true,
    cameraFittedForDiagnostic: true,
    mainViewerSourceIntegrated: true,
    browserRun: false,
    threeGpuSubmissionObserved: false,
    leagueReferenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/replay-particle-gpu.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result.counts));
