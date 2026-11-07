import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestAnimationEvents } from "../latest-animation-events.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-animation-events.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  definitionBytes = await Bun.file(
    `${root}/animation-events.json`,
  ).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  definition = JSON.parse(new TextDecoder().decode(definitionBytes)),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  vendor = resolve(dirname(root), "vendor/unicorn_x86_candidate.mjs"),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer());
if (
  native.definitionSha256 !== hash(definitionBytes) ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(await Bun.file(vendor).arrayBuffer()) !== definition.runtimeSha256
)
  throw Error("Animation event comparison source mismatch");
for (const [name, digest] of Object.entries({
  ...definition.compilerSources,
  ...native.compilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale animation event compiler: ${name}`);
for (const block of native.executedOriginalBlocks)
  if (hash(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Animation observation code differs from prepared image");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  kernel = await createLatestAnimationEvents(
    uc,
    profile,
    image,
    await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
    definitionBytes,
  ),
  mismatches = [],
  canonical = (v) => JSON.stringify(v),
  timings = [];
let frames = 0,
  restoredFrames = 0,
  resetFrames = 0,
  requests = 0;
try {
  for (const [index, sequence] of native.sequences.entries()) {
    kernel.load(sequence.events);
    const midpoint = Math.floor(sequence.frames.length / 2);
    let checkpoint;
    for (const [i, frame] of sequence.frames.entries()) {
      if (i === midpoint) checkpoint = kernel.checkpoint();
      const start = performance.now(),
        actual = kernel.step(frame.input.frame, frame.input.resync);
      timings.push(performance.now() - start);
      frames++;
      requests += actual.requests.length;
      if (canonical(actual) !== canonical(frame.output))
        mismatches.push({
          sequence: index,
          frame: i,
          phase: "forward",
          actual,
          expected: frame.output,
        });
    }
    kernel.restore(checkpoint);
    for (let i = midpoint; i < sequence.frames.length; i++) {
      const frame = sequence.frames[i],
        actual = kernel.step(frame.input.frame, frame.input.resync);
      restoredFrames++;
      if (canonical(actual) !== canonical(frame.output))
        mismatches.push({
          sequence: index,
          frame: i,
          phase: "restored",
          actual,
          expected: frame.output,
        });
    }
    kernel.releaseCheckpoint(checkpoint);
    kernel.reset();
    for (const [i, frame] of sequence.frames.entries()) {
      const actual = kernel.step(frame.input.frame, frame.input.resync);
      resetFrames++;
      if (canonical(actual) !== canonical(frame.output))
        mismatches.push({
          sequence: index,
          frame: i,
          phase: "reset",
          actual,
          expected: frame.output,
        });
    }
  }
} finally {
  kernel.close();
}
const result = {
  schema: 1,
  build: definition.build,
  protocol: definition.protocol,
  definitionSha256: hash(definitionBytes),
  nativeEvidenceSha256: hash(nativeBytes),
  runtimeSha256: definition.runtimeSha256,
  decoderImageSha256: profile.decoderImageSha256,
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-animation-events.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  executorSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-spawn.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  sequences: native.sequences.length,
  frames,
  restoredFrames,
  resetFrames,
  requests,
  originalBlocks: native.executedOriginalBlocks.length,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 20),
  timingMs: {
    total: timings.reduce((a, b) => a + b, 0),
    maximum: Math.max(...timings),
  },
  scope: definition.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    sequences: result.sequences,
    frames,
    restoredFrames,
    resetFrames,
    requests,
    originalBlocks: result.originalBlocks,
    mismatches: mismatches.length,
    timingMs: result.timingMs,
  }),
);
if (mismatches.length) process.exitCode = 1;
