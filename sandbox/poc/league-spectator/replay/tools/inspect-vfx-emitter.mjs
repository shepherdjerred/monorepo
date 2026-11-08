import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxEmitter,
  emitterPreviewMath,
} from "../latest-vfx-emitter.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-emitter.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  emitterBytes = await Bun.file(`${root}/vfx-emitter.json`).arrayBuffer(),
  metadata = JSON.parse(new TextDecoder().decode(emitterBytes)),
  spawnBytes = await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  hash = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  runtimeBytes = await Bun.file(
    `${vendor}/unicorn_x86_candidate.mjs`,
  ).arrayBuffer();
if (
  hash(emitterBytes) !== profile.vfxEmitterSha256 ||
  native.definitionSha256 !== profile.vfxEmitterSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  hash(runtimeBytes) !== metadata.runtimeSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest
)
  throw Error("Emitter comparison source mismatch");
for (const [name, digest] of Object.entries({
  ...native.compilerSources,
  ...native.spawnCompilerSources,
}))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale emitter compiler ${name}`);
if (
  hash(
    await Bun.file(
      new URL("observe-vfx-emitter.py", import.meta.url),
    ).arrayBuffer(),
  ) !== native.observerSourceSha256
)
  throw Error("Stale emitter observer");
const { default: createUnicorn } = await import(
    pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createUnicorn(),
  mismatches = [],
  timings = [],
  samples = [],
  lifecycles = [];
let frames = 0,
  matches = 0,
  births = 0,
  vertices = 0,
  indices = 0,
  poolBytes = 0,
  repeatMatches = 0,
  checkpointFrames = 0,
  checkpointMatches = 0,
  checkpointRejections = 0;
const checkpoints = [];
let foreignHandle;
function requireCheckpointRejection(action) {
  try {
    action();
  } catch (error) {
    if (
      error.message !== "Unknown, released or foreign native emitter checkpoint"
    )
      throw error;
    checkpointRejections++;
    return;
  }
  throw Error("Invalid checkpoint was accepted");
}
const canonical = (value) =>
    JSON.stringify(value, (_key, item) =>
      Object.is(item, -0)
        ? { negativeZero: true }
        : item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
            )
          : item,
    ),
  hex = (bytes) => Buffer.from(bytes).toString("hex"),
  serialize = (value) => ({
    state: value.state,
    geometry: {
      verticesHex: hex(value.geometry.vertices),
      indicesHex: hex(value.geometry.indices),
      drawHex: hex(value.geometry.draw),
      mathCalls: value.geometry.mathCalls,
    },
  });
for (const reference of metadata.templates) {
  const graphBytes = await Bun.file(`${root}/${reference.file}`).arrayBuffer(),
    kernel = await createLatestVfxEmitter(
      uc,
      profile,
      image,
      spawnBytes,
      graphBytes,
      emitterBytes,
      emitterPreviewMath,
    ),
    cases = native.cases.filter((c) => c.graphSha256 === reference.sha256);
  try {
    if (foreignHandle)
      requireCheckpointRejection(() => kernel.restore(foreignHandle));
    for (const sample of cases) {
      kernel.reset(BigInt(`0x${sample.seedHex}`), sample.smoothingQuality);
      const lifecycle = [],
        saved = [],
        captureIndices = new Set([
          0,
          Math.floor(sample.steps.length / 4),
          Math.floor(sample.steps.length / 2),
          sample.steps.length - 1,
        ]);
      for (const [index, step] of sample.steps.entries()) {
        if (captureIndices.has(index))
          saved.push({ index, handle: kernel.checkpoint() });
        const start = performance.now(),
          output = serialize(kernel.frame(step.input));
        timings.push(performance.now() - start);
        frames++;
        births += output.state.births.length;
        vertices += output.geometry.verticesHex.length / 56;
        indices += output.geometry.indicesHex.length / 4;
        poolBytes += Object.values(output.state.vectors).reduce(
          (n, v) => n + v.hex.length / 2,
          0,
        );
        if (canonical(output) !== canonical(step.output)) {
          const keys = Object.keys(output.state).filter(
            (key) =>
              canonical(output.state[key]) !==
              canonical(step.output.state[key]),
          );
          mismatches.push({
            graphSha256: reference.sha256,
            seedHex: sample.seedHex,
            clock: sample.clockIndex,
            index,
            keys,
            geometryMatch:
              canonical(output.geometry) === canonical(step.output.geometry),
          });
          if (mismatches.length <= 2)
            await Bun.write(
              `${outputPath}.mismatch-${mismatches.length}.json`,
              JSON.stringify(
                { actual: output, expected: step.output },
                null,
                2,
              ),
            );
        } else matches++;
        lifecycle.push({
          time: step.input.time,
          births: output.state.births.length,
          pool: output.state.vectors.life.count,
        });
        if (
          sample.seedHex === "000000000000915c" &&
          sample.clockIndex === 0 &&
          [12, 30, 54, 78, 120].includes(index)
        )
          samples.push({
            effectId: reference.effectId,
            emitterIndex: reference.emitterIndex,
            input: step.input,
            output,
          });
      }
      lifecycles.push({
        emitterIndex: reference.emitterIndex,
        seedHex: sample.seedHex,
        clock: sample.clockIndex,
        values: lifecycle,
      });
      foreignHandle ??= saved[0].handle;
      requireCheckpointRejection(() =>
        kernel.restore(Object.freeze({ ...saved[0].handle })),
      );
      // Deliberately overwrite the component with another seed and quality,
      // then restore saved states in a nonchronological order.
      for (const item of [saved[3], saved[2], saved[0], saved[1]]) {
        kernel.reset(
          BigInt(`0x${sample.seedHex}`) ^ 0x80000000n,
          sample.smoothingQuality === 2 ? 0 : 2,
        );
        for (const step of sample.steps.slice(0, 2)) kernel.frame(step.input);
        const start = performance.now();
        kernel.restore(item.handle);
        const restoreMs = performance.now() - start,
          expectedHash = new Bun.CryptoHasher("sha256"),
          actualHash = new Bun.CryptoHasher("sha256");
        let restored = 0;
        for (const [offset, step] of sample.steps.slice(item.index).entries()) {
          const actual = canonical(serialize(kernel.frame(step.input))),
            expected = canonical(step.output);
          actualHash.update(actual);
          expectedHash.update(expected);
          checkpointFrames++;
          if (actual !== expected)
            mismatches.push({
              kind: "checkpoint",
              emitterIndex: reference.emitterIndex,
              seedHex: sample.seedHex,
              clock: sample.clockIndex,
              capturedIndex: item.index,
              index: item.index + offset,
            });
          else {
            restored++;
            checkpointMatches++;
          }
        }
        checkpoints.push({
          emitterIndex: reference.emitterIndex,
          seedHex: sample.seedHex,
          clock: sample.clockIndex,
          index: item.index,
          elapsedTime: item.handle.elapsedTime,
          bytes: item.handle.bytes,
          restoreMs,
          frames: sample.steps.length - item.index,
          matches: restored,
          expectedSha256: expectedHash.digest("hex"),
          actualSha256: actualHash.digest("hex"),
        });
        kernel.releaseCheckpoint(item.handle);
        requireCheckpointRejection(() => kernel.restore(item.handle));
      }
      console.log(
        JSON.stringify({
          emitter: reference.emitterIndex,
          seed: sample.seedHex,
          clock: sample.clockIndex,
          frames: sample.steps.length,
          mismatches: mismatches.length,
          checkpointMatches,
        }),
      );
    }
    const sample = cases.find((c) => c.clockIndex === 2);
    kernel.reset(BigInt(`0x${sample.seedHex}`), sample.smoothingQuality);
    for (const step of sample.steps) {
      if (
        canonical(serialize(kernel.frame(step.input))) !==
        canonical(step.output)
      )
        mismatches.push({
          kind: "reset-order",
          emitterIndex: reference.emitterIndex,
        });
      else repeatMatches++;
    }
  } finally {
    kernel.close();
  }
}
const sources = Object.fromEntries(
    await Promise.all(
      [
        "latest-vfx-emitter.mjs",
        "latest-vfx-spawn.mjs",
        "native-decoder.mjs",
      ].map(async (name) => [
        name,
        hash(
          await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
        ),
      ]),
    ),
  ),
  result = {
    schema: 1,
    build: native.build,
    protocol: native.protocol,
    definitionSha256: hash(emitterBytes),
    nativeEvidenceSha256: hash(nativeBytes),
    runtimeSha256: hash(runtimeBytes),
    sources,
    observerSourceSha256: native.observerSourceSha256,
    compilerSources: native.compilerSources,
    spawnCompilerSources: native.spawnCompilerSources,
    graphs: metadata.templates.length,
    cases: native.cases.length,
    frames,
    matches,
    births,
    vertices,
    indices,
    poolBytes,
    repeatMatches,
    checkpointFrames,
    checkpointMatches,
    checkpointRejections,
    checkpoints,
    globalWrites: native.globalWrites,
    mismatches,
    executedOriginalBlocks: native.executedOriginalBlocks,
    mathProvider: native.mathProvider,
    timings,
    samples,
    lifecycles,
    scope: metadata.scope,
  };
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    graphs: result.graphs,
    cases: result.cases,
    frames,
    matches,
    births,
    vertices,
    indices,
    poolBytes,
    repeatMatches,
    checkpointFrames,
    checkpointMatches,
    checkpointRejections,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
