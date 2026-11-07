import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxSystem,
  systemPreviewMath,
} from "../latest-vfx-system.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-system.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  systemBytes = await Bun.file(`${root}/vfx-system.json`).arrayBuffer(),
  metadata = JSON.parse(new TextDecoder().decode(systemBytes)),
  spawnBytes = await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
  emitterBytes = await Bun.file(`${root}/vfx-emitter.json`).arrayBuffer(),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  runtimeBytes = await Bun.file(
    `${vendor}/unicorn_x86_candidate.mjs`,
  ).arrayBuffer(),
  hash = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
if (
  hash(systemBytes) !== profile.vfxSystemSha256 ||
  native.definitionSha256 !== profile.vfxSystemSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  hash(runtimeBytes) !== metadata.runtimeSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest
)
  throw Error("System comparison source mismatch");
for (const [name, digest] of Object.entries(native.compilerSources))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error(`Stale system source ${name}`);
if (
  hash(
    await Bun.file(
      new URL("observe-vfx-system.py", import.meta.url),
    ).arrayBuffer(),
  ) !== native.observerSourceSha256
)
  throw Error("Stale system observer evidence");
const { default: createUnicorn } = await import(
    pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createUnicorn(),
  mismatches = [],
  timings = [],
  lifecycles = [],
  samples = [],
  checkpoints = [];
let ticks = 0,
  matches = 0,
  substeps = 0,
  births = 0,
  vertices = 0,
  indices = 0,
  poolBytes = 0,
  checkpointTicks = 0,
  checkpointMatches = 0,
  rejections = 0,
  renderOnlyMatches = 0;
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
  serialize = (value, kernel) => {
    const memory = kernel.inspectState();
    return {
      state: value.state,
      substeps: value.substeps,
      geometry: {
        verticesHex: hex(value.geometry.vertices),
        indicesHex: hex(value.geometry.indices),
        drawHex: hex(value.geometry.draw),
        mathCalls: value.geometry.mathCalls,
      },
      memory: {
        contextSha256: hash(memory.context),
        arenaSha256: hash(memory.arena),
        globalsHex: memory.globals.map(hex),
        allocationSha256: hash(JSON.stringify(memory.allocations)),
        nextHeap: memory.nextHeap,
      },
    };
  };
function rejectHandle(action) {
  try {
    action();
  } catch (error) {
    if (
      error.message !==
      "Unknown, released or foreign particle-system checkpoint"
    )
      throw error;
    rejections++;
    return;
  }
  throw Error("Invalid particle-system checkpoint accepted");
}
for (const reference of metadata.templates) {
  const graphBytes = await Bun.file(`${root}/${reference.file}`).arrayBuffer(),
    kernel = await createLatestVfxSystem(
      uc,
      profile,
      image,
      spawnBytes,
      graphBytes,
      emitterBytes,
      systemBytes,
      systemPreviewMath,
    ),
    cases = native.cases.filter(
      (sample) => sample.graphSha256 === reference.sha256,
    );
  try {
    for (const sample of cases) {
      kernel.reset(
        BigInt(`0x${sample.seedHex}`),
        sample.smoothingQuality,
        sample.creation,
      );
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
          actual = serialize(kernel.tick(step.input), kernel);
        timings.push(performance.now() - start);
        ticks++;
        births += actual.state.births.length;
        substeps += actual.substeps.length;
        vertices += actual.geometry.verticesHex.length / 56;
        indices += actual.geometry.indicesHex.length / 4;
        poolBytes += Object.values(actual.state.vectors).reduce(
          (sum, v) => sum + v.hex.length / 2,
          0,
        );
        if (canonical(actual) !== canonical(step.output)) {
          const keys = Object.keys(actual).filter(
            (key) => canonical(actual[key]) !== canonical(step.output[key]),
          );
          mismatches.push({
            kind: "forward",
            emitterIndex: reference.emitterIndex,
            seedHex: sample.seedHex,
            profile: sample.profile,
            index,
            keys,
          });
          if (mismatches.length <= 2)
            await Bun.write(
              `${outputPath}.mismatch-${mismatches.length}.json`,
              JSON.stringify({ actual, expected: step.output }, null, 2),
            );
        } else matches++;
        if (captureIndices.has(index)) {
          const before = kernel.inspectState(),
            geometry = kernel.render(step.input.viewForward),
            after = kernel.inspectState(),
            repeated = {
              verticesHex: hex(geometry.vertices),
              indicesHex: hex(geometry.indices),
              drawHex: hex(geometry.draw),
              mathCalls: geometry.mathCalls,
            };
          if (
            canonical(repeated) !== canonical(actual.geometry) ||
            hash(before.context) !== hash(after.context) ||
            hash(before.arena) !== hash(after.arena) ||
            canonical(before.globals.map(hex)) !==
              canonical(after.globals.map(hex)) ||
            canonical(before.allocations) !== canonical(after.allocations) ||
            before.nextHeap !== after.nextHeap
          )
            mismatches.push({
              kind: "render-only",
              emitterIndex: reference.emitterIndex,
              profile: sample.profile,
              index,
            });
          else renderOnlyMatches++;
        }
        lifecycle.push({
          time: step.input.time,
          pool: actual.state.vectors.life.count,
          births: actual.state.births.length,
          substeps: actual.substeps.map((value) => value.time),
        });
        if (
          sample.seedHex === "000000000000915c" &&
          ["regular-offset", "irregular", "budget-four", "budget-one"].includes(
            sample.profile,
          ) &&
          [
            Math.floor(sample.steps.length / 4),
            Math.floor(sample.steps.length / 2),
            sample.steps.length - 1,
          ].includes(index)
        )
          samples.push({
            effectId: reference.effectId,
            emitterIndex: reference.emitterIndex,
            profile: sample.profile,
            creation: sample.creation,
            input: step.input,
            output: actual,
          });
      }
      lifecycles.push({
        emitterIndex: reference.emitterIndex,
        seedHex: sample.seedHex,
        profile: sample.profile,
        creation: sample.creation,
        values: lifecycle,
      });
      rejectHandle(() => kernel.restore(Object.freeze({ ...saved[0].handle })));
      for (const item of [saved[3], saved[2], saved[0], saved[1]]) {
        const foreign = {
          createdAt: sample.creation.createdAt + 7,
          position: sample.creation.position.map((v) => v + 100),
        };
        kernel.reset(
          BigInt(`0x${sample.seedHex}`) ^ 0x80000000n,
          sample.smoothingQuality === 2 ? 0 : 2,
          foreign,
        );
        kernel.tick({
          time: foreign.createdAt,
          current: foreign.position,
          viewForward: [0, -1, 0],
          maxSubsteps: 1,
        });
        const start = performance.now();
        kernel.restore(item.handle);
        const restoreMs = performance.now() - start,
          expectedHash = new Bun.CryptoHasher("sha256"),
          actualHash = new Bun.CryptoHasher("sha256");
        let restored = 0;
        for (const [offset, step] of sample.steps.slice(item.index).entries()) {
          const actual = canonical(serialize(kernel.tick(step.input), kernel)),
            expected = canonical(step.output);
          actualHash.update(actual);
          expectedHash.update(expected);
          checkpointTicks++;
          if (actual !== expected)
            mismatches.push({
              kind: "checkpoint",
              emitterIndex: reference.emitterIndex,
              seedHex: sample.seedHex,
              profile: sample.profile,
              capturedIndex: item.index,
              index: item.index + offset,
            });
          else {
            checkpointMatches++;
            restored++;
          }
        }
        checkpoints.push({
          emitterIndex: reference.emitterIndex,
          seedHex: sample.seedHex,
          profile: sample.profile,
          index: item.index,
          time: item.handle.time,
          bytes: item.handle.bytes,
          restoreMs,
          ticks: sample.steps.length - item.index,
          matches: restored,
          expectedSha256: expectedHash.digest("hex"),
          actualSha256: actualHash.digest("hex"),
        });
        kernel.releaseCheckpoint(item.handle);
        rejectHandle(() => kernel.restore(item.handle));
      }
      console.log(
        JSON.stringify({
          emitter: reference.emitterIndex,
          seed: sample.seedHex,
          profile: sample.profile,
          ticks: sample.steps.length,
          mismatches: mismatches.length,
          checkpointMatches,
        }),
      );
    }
  } finally {
    kernel.close();
  }
}
const sources = Object.fromEntries(
    await Promise.all(
      [
        "latest-vfx-system.mjs",
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
    definitionSha256: hash(systemBytes),
    nativeEvidenceSha256: hash(nativeBytes),
    runtimeSha256: hash(runtimeBytes),
    sources,
    observerSourceSha256: native.observerSourceSha256,
    compilerSources: native.compilerSources,
    graphs: metadata.templates.length,
    cases: native.cases.length,
    ticks,
    matches,
    substeps,
    births,
    vertices,
    indices,
    poolBytes,
    checkpointTicks,
    checkpointMatches,
    checkpoints,
    rejections,
    renderOnlyMatches,
    mismatches,
    executedOriginalBlocks: native.executedOriginalBlocks,
    globalWrites: native.globalWrites,
    mathProvider: native.mathProvider,
    timings,
    samples,
    lifecycles,
    scope: metadata.scope,
  };
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    cases: result.cases,
    ticks,
    matches,
    substeps,
    births,
    vertices,
    indices,
    checkpoints: checkpoints.length,
    checkpointTicks,
    checkpointMatches,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
