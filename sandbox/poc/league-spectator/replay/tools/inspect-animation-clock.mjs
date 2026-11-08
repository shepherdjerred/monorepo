import { resolve } from "node:path";
import {
  createLatestAnimationClock,
  sampleNativeAtomicClock,
} from "../latest-animation-clock.mjs";

const [packagePath, scenePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-animation-clock.mjs <decoder> <scene> <native> <comparison>",
  );
const root = resolve(packagePath),
  scene = resolve(scenePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  definitionBytes = await Bun.file(
    `${root}/animation-clock.json`,
  ).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  definition = JSON.parse(new TextDecoder().decode(definitionBytes)),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  profile = await Bun.file(`${root}/profile.json`).json(),
  factory = await createLatestAnimationClock(profile, definitionBytes),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  bound = new Map(),
  mismatches = [];
if (
  native.definitionSha256 !== hash(definitionBytes) ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  hash(image) !== profile.decoderImageSha256
)
  throw Error("Atomic clock observation source mismatch");
for (const [name, digest] of Object.entries({
  ...definition.compilerSources,
  ...native.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale atomic clock compiler: ${name}`);
for (const block of native.executedOriginalBlocks)
  if (hash(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Atomic clock observation block differs from prepared image");
for (const [file, graph] of Object.entries(definition.graphs)) {
  bound.set(
    file,
    await factory.bind(
      file,
      await Bun.file(`${scene}/${file}`).arrayBuffer(),
      await Bun.file(`${scene}/${graph.catalogFile}`).arrayBuffer(),
    ),
  );
  if (
    hash(
      await Bun.file(`${scene}/${graph.selectedClipsFile}`).arrayBuffer(),
    ) !== graph.selectedClipsSha256
  )
    throw Error("Atomic clock source mapping changed");
  for (const clip of Object.values(graph.clips))
    if (
      hash(await Bun.file(`${scene}/${clip.source.file}`).arrayBuffer()) !==
      clip.source.sha256
    )
      throw Error("Raw ANM source changed");
}
const hex = (n) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, n, true);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
let samples = 0,
  boundSamples = 0;
for (const [i, observation] of native.observations.entries()) {
  for (const [j, sample] of observation.samples.entries()) {
    const input = sample.input,
      actual = sampleNativeAtomicClock(
        observation.clock,
        input.elapsed,
        input.delta,
        input.rate,
      ),
      bits = {
        frameHex: hex(actual.frame),
        elapsedHex: hex(actual.elapsed),
        durationHex: hex(actual.duration),
        poseTimeHex: hex(actual.poseTime),
        poseFrameHex: hex(actual.poseFrame),
      };
    samples++;
    if (JSON.stringify(bits) !== JSON.stringify(sample.output))
      mismatches.push({
        observation: i,
        sample: j,
        actual: bits,
        expected: sample.output,
      });
    if (observation.graph) {
      const joined = bound
        .get(observation.graph)
        .evaluate(observation.clip, input.elapsed, input.delta, input.rate);
      boundSamples++;
      if (JSON.stringify(joined) !== JSON.stringify(actual))
        throw Error("Bound atomic clock differs from native-input projection");
    }
  }
}
const result = {
  schema: 1,
  build: definition.build,
  protocol: definition.protocol,
  definitionSha256: hash(definitionBytes),
  nativeEvidenceSha256: hash(nativeBytes),
  decoderImageSha256: profile.decoderImageSha256,
  sources: Object.fromEntries(
    await Promise.all(
      ["latest-animation-clock.mjs", "latest-animation.mjs"].map(
        async (name) => [
          name,
          hash(
            await Bun.file(
              new URL(`../${name}`, import.meta.url),
            ).arrayBuffer(),
          ),
        ],
      ),
    ),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  samples,
  boundSamples,
  graphs: bound.size,
  originalBlocks: native.executedOriginalBlocks.length,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 20),
  scope: definition.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    samples,
    boundSamples,
    graphs: bound.size,
    originalBlocks: result.originalBlocks,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
