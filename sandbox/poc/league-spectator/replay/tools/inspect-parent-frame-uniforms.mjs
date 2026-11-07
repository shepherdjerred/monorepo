// Compare shared reflected packing against the original native copy routine.
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createLatestNativeParentMaterials } from "../latest-native-parent-materials.mjs";
import {
  packParentReflectedVectors,
  parentFrameUniformBlocks,
} from "../latest-parent-frame-uniforms.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const bytes = await Bun.file(p).bytes();
    inputs[p] = sha(bytes);
    return bytes;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  unhex = (h) => Uint8Array.from(Buffer.from(h, "hex")),
  native = await read(`${cache}/research/parent-frame-uniforms-native.json`),
  draw = await read(`${cache}/research/parent-draw-parameters-native.json`),
  proof = await read(
    `${cache}/research/parent-draw-parameters-comparison.json`,
  ),
  api = await createLatestNativeParentMaterials({
    profile: await read(`${assets}/decoder-16.21-macos/profile.json`),
    packageBytes: await raw(
      `${assets}/latest-parent-native-materials/package.json`,
    ),
    effectsManifestBytes: await raw(`${assets}/latest-effects/manifest.json`),
  }),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  scene = Object.fromEntries(
    Object.entries(native.sceneVectorsHex).map(([k, v]) => [k, unhex(v)]),
  );
check(
  native.kind === "original-parent-frame-uniform-observations" &&
    native.counts.blocks === 664 &&
    proof.mismatchCount === 0 &&
    proof.counts.roots === 14,
  "Complete native frame packing and WASM draw-prefix proof required",
);
for (const report of [native, proof]) {
  for (const [name, digest] of Object.entries(report.sources))
    check(
      sha(await raw(`${root}/${report === native ? "tools/" : ""}${name}`)) ===
        digest,
      `Uniform producer changed: ${name}`,
    );
  for (const [path, digest] of Object.entries(report.inputs))
    check(sha(await raw(path)) === digest, `Uniform input changed: ${path}`);
}
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original uniform pack code changed",
  );
const counts = {
    roots: 0,
    drawRecords: 0,
    nativeBlocks: 0,
    preparedBlocks: 0,
    capturedBlocks: 0,
  },
  stages = new Map();
for (const c of native.cases) {
  const packed = packParentReflectedVectors(
    c.block,
    c.uniforms.map((v) => ({ name: v.name, bytes: unhex(v.bytesHex) })),
  );
  check(
    Buffer.from(packed.bytes).toString("hex") === c.bytesHex,
    "Original native/JS reflected bytes differ",
  );
  counts.nativeBlocks++;
}
for (const c of draw.cases) {
  for (const frame of c.frames)
    for (const parameters of frame.drawParameters) {
      const selected = api.resolve(
          c.effectId,
          parameters.emitterIndex,
          parameters.passHash,
          0,
        ),
        pair = [];
      for (const stage of ["vertex", "pixel"]) {
        const id = selected.variant.shaders[stage].sha256;
        if (!stages.has(id))
          stages.set(
            id,
            await api.loadShader(id, (name) =>
              raw(`${assets}/latest-shaders/${name}`),
            ),
          );
        pair.push(stages.get(id));
      }
      const blocks = parentFrameUniformBlocks(
        selected,
        pair,
        parameters,
        scene,
      );
      for (const b of blocks) {
        counts.preparedBlocks++;
        if (b.source === "captured-native-material") {
          const expected = selected.variant.constantBuffers.find(
            (v) => v.stage === b.stage && v.name === b.name,
          );
          check(
            Buffer.from(b.bytes).toString("hex") === expected.bytesHex,
            "Captured material bytes changed during frame packing",
          );
          counts.capturedBlocks++;
        } else {
          const expected = native.cases.find(
            (v) =>
              v.effectId === c.effectId &&
              v.tick === frame.tick &&
              v.emitterIndex === parameters.emitterIndex &&
              v.stage === b.stage &&
              v.block.glslName === b.name,
          );
          check(
            expected &&
              Buffer.from(b.bytes).toString("hex") === expected.bytesHex,
            "Integrated frame block differs from original native packing",
          );
        }
      }
      // Exports own their bytes; native frames and immutable material snapshots stay intact.
      const repeated = parentFrameUniformBlocks(
        selected,
        pair,
        parameters,
        scene,
      );
      check(
        isDeepStrictEqual(blocks, repeated),
        "Repeated frame packing differs",
      );
      blocks[0].bytes[0] ^= 255;
      check(
        isDeepStrictEqual(
          parentFrameUniformBlocks(selected, pair, parameters, scene),
          repeated,
        ),
        "Frame block export aliases material/input storage",
      );
      counts.drawRecords++;
    }
  counts.roots++;
}
const bundled = await Bun.build({
  entrypoints: [`${root}/latest-parent-frame-uniforms.mjs`],
  target: "browser",
  write: false,
});
check(bundled.success, "Frame uniform browser bundle failed");
const sources = {};
for (const name of [
  "latest-parent-frame-uniforms.mjs",
  "latest-native-parent-materials.mjs",
  "tools/inspect-parent-frame-uniforms.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "original-native-javascript-parent-frame-uniform-comparison",
  inputs,
  sources,
  counts,
  mismatchCount: 0,
  scope: {
    originalNativeCopyExecuted: true,
    integratedMaterialBlocksCompared: true,
    exportIsolationCompared: true,
    browserBundleBuilt: true,
    controlledSceneVectors: true,
    gpuSubmitted: false,
    replaySceneRecovered: false,
  },
};
await Bun.write(
  `${cache}/research/parent-frame-uniforms-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
