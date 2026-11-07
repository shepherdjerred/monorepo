import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxUvAnimation,
  uvAnimationPreviewMath,
} from "../latest-vfx-uv-animation.mjs";

const [packagePath, nativePath, outputPath, motionPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-uv-animation.mjs <decoder> <native> <comparison>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor");
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const profile = await Bun.file(`${root}/profile.json`).json();
const metadataBytes = await Bun.file(
  `${root}/vfx-uv-animation.json`,
).arrayBuffer();
const meta = JSON.parse(new TextDecoder().decode(metadataBytes));
const nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes));
const image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer());
if (
  hash(metadataBytes) !== profile.vfxUvAnimationSha256 ||
  native.definitionSha256 !== profile.vfxUvAnimationSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(await Bun.file(`${vendor}/unicorn_x86_candidate.mjs`).arrayBuffer()) !==
    meta.runtimeSha256
)
  throw Error("UV animation evidence identity mismatch");
for (const group of [meta.compilerSources, native.sourceFiles])
  for (const [name, digest] of Object.entries(group))
    if (
      hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
      digest
    )
      throw Error(`Stale UV animation source ${name}`);
const { default: createUnicorn } = await import(
  pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
);
const uc = await createUnicorn(),
  kernel = await createLatestVfxUvAnimation(
    uc,
    profile,
    image,
    metadataBytes,
    uvAnimationPreviewMath,
  );
const canonical = (v) =>
  JSON.stringify(v, (_k, item) =>
    Object.is(item, -0) ? "__negative_zero__" : item,
  );
const mismatches = [];
let births = 0,
  samples = 0,
  matrices = 0,
  motionSamples = 0;
let motionEvidenceSha256 = null;
try {
  for (const reference of meta.templates) {
    const graphBytes = await Bun.file(
      `${root}/${reference.file}`,
    ).arrayBuffer();
    await kernel.loadGraph(graphBytes);
    for (const sample of native.cases.filter(
      (c) => c.graphSha256 === reference.sha256,
    )) {
      const actualBirth = kernel.birth(sample.birthInput);
      if (canonical(actualBirth) !== canonical(sample.birth))
        mismatches.push({
          kind: "birth",
          graph: reference.sha256,
          input: sample.birthInput,
          expected: sample.birth,
          actual: actualBirth,
        });
      births++;
      for (const frame of sample.frames) {
        const actual = kernel.sample(frame.input);
        if (canonical(actual) !== canonical(frame.output))
          mismatches.push({
            kind: "sample",
            graph: reference.sha256,
            birthInput: sample.birthInput,
            input: frame.input,
            expected: frame.output,
            actual,
          });
        samples++;
        matrices += Object.values(actual.matrices).filter(
          (v) => v !== null,
        ).length;
      }
    }
  }
  if (motionPath) {
    const motionBytes = await Bun.file(motionPath).arrayBuffer();
    const motion = JSON.parse(new TextDecoder().decode(motionBytes));
    if (
      motion.definitionSha256 !== profile.vfxUvAnimationSha256 ||
      motion.nativeSha256 !== hash(nativeBytes) ||
      motion.moduleSha256 !==
        hash(
          await Bun.file(
            new URL("../latest-vfx-uv-animation.mjs", import.meta.url),
          ).arrayBuffer(),
        ) ||
      motion.rendererSha256 !==
        hash(
          await Bun.file(
            new URL("render-vfx-uv-animation-evidence.py", import.meta.url),
          ).arrayBuffer(),
        )
    )
      throw Error("UV motion diagnostic identity mismatch");
    motionEvidenceSha256 = hash(motionBytes);
    for (const item of motion.cases) {
      const reference = meta.templates.find(
        (t) => t.sha256 === item.graphSha256,
      );
      if (!reference) throw Error("UV motion graph missing");
      await kernel.loadGraph(
        await Bun.file(`${root}/${reference.file}`).arrayBuffer(),
      );
      const birth = kernel.birth(item.birthInput);
      if (canonical(birth) !== canonical(item.birth))
        mismatches.push({ kind: "motion-birth", id: item.id });
      for (const frame of item.frames) {
        const actual = kernel.sample(frame.input);
        if (canonical(actual) !== canonical(frame.output))
          mismatches.push({
            kind: "motion-frame",
            id: item.id,
            input: frame.input,
            expected: frame.output,
            actual,
          });
        motionSamples++;
      }
    }
  }
} finally {
  kernel.close();
}
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  definitionSha256: hash(metadataBytes),
  nativeSha256: hash(nativeBytes),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-uv-animation.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  coverage: meta.coverage,
  ...native.summary,
  matchedBirths: births,
  matchedSamples: samples,
  matchedMatrices: matrices,
  motionSamples,
  motionEvidenceSha256,
  originalBlocks: native.originalBlocks.length,
  mismatches,
  scope: native.scope,
};
await Bun.write(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    ...native.summary,
    mismatches: mismatches.length,
    originalBlocks: result.originalBlocks,
  }),
);
if (mismatches.length) throw Error("Native/WASM UV animation mismatch");
