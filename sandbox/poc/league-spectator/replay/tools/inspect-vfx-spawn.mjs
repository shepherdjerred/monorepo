import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxSpawn,
  spawnPreviewMath,
} from "../latest-vfx-spawn.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-spawn.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  vendor = resolve(dirname(root), "vendor"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  metadataBytes = await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
  metadata = JSON.parse(new TextDecoder().decode(metadataBytes)),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  runtimeBytes = await Bun.file(
    `${vendor}/unicorn_x86_candidate.mjs`,
  ).arrayBuffer(),
  hash = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
if (
  hash(metadataBytes) !== profile.vfxSpawnSha256 ||
  native.definitionSha256 !== profile.vfxSpawnSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(runtimeBytes) !== metadata.runtimeSha256
)
  throw Error("Spawn comparison source mismatch");
for (const [name, digest] of Object.entries(metadata.compilerSources))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error("Stale spawn compiler evidence");
if (
  hash(
    await Bun.file(
      new URL("observe-vfx-spawn.py", import.meta.url),
    ).arrayBuffer(),
  ) !== native.observerSourceSha256
)
  throw Error("Stale spawn observer evidence");
const { default: createUnicorn } = await import(
    pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createUnicorn(),
  mismatches = [],
  timings = [],
  samples = [];
let steps = 0,
  births = 0,
  poolBytes = 0,
  matches = 0,
  repeatMatches = 0;
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
for (const reference of metadata.templates) {
  const graphBytes = await Bun.file(`${root}/${reference.file}`).arrayBuffer(),
    kernel = await createLatestVfxSpawn(
      uc,
      profile,
      image,
      metadataBytes,
      graphBytes,
      spawnPreviewMath,
    ),
    cases = native.cases.filter(
      (sample) => sample.graphSha256 === reference.sha256,
    );
  try {
    for (const sample of cases) {
      kernel.reset(BigInt(`0x${sample.seedHex}`));
      for (const [index, step] of sample.steps.entries()) {
        const start = performance.now(),
          actual = kernel.step(step.input);
        timings.push(performance.now() - start);
        steps++;
        births += actual.births.length;
        poolBytes += Object.values(actual.vectors).reduce(
          (n, v) => n + v.hex.length / 2,
          0,
        );
        if (canonical(actual) !== canonical(step.output)) {
          const keys = Object.keys(actual).filter(
            (key) => canonical(actual[key]) !== canonical(step.output[key]),
          );
          mismatches.push({
            graphSha256: reference.sha256,
            seedHex: sample.seedHex,
            index,
            keys,
          });
        } else matches++;
        if (sample === cases[2])
          samples.push({
            effectId: reference.effectId,
            emitterIndex: reference.emitterIndex,
            input: step.input,
            output: actual,
          });
      }
    }
    // Reset after unrelated sequences, then compare the whole pool again.
    const sample = cases[2];
    kernel.reset(BigInt(`0x${sample.seedHex}`));
    for (const step of sample.steps) {
      if (canonical(kernel.step(step.input)) !== canonical(step.output))
        mismatches.push({ kind: "reset-order", graphSha256: reference.sha256 });
      else repeatMatches++;
    }
  } finally {
    kernel.close();
  }
}
const sources = Object.fromEntries(
    await Promise.all(
      ["latest-vfx-spawn.mjs", "native-decoder.mjs"].map(async (name) => [
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
    definitionSha256: hash(metadataBytes),
    nativeEvidenceSha256: hash(nativeBytes),
    runtimeSha256: hash(runtimeBytes),
    sources,
    observerSourceSha256: native.observerSourceSha256,
    compilerSources: metadata.compilerSources,
    graphs: metadata.templates.length,
    cases: native.cases.length,
    steps,
    births,
    poolBytes,
    matches,
    repeatMatches,
    mismatches,
    executedOriginalBlocks: native.executedOriginalBlocks,
    mathProvider: native.mathProvider,
    wasmMathPolicy: spawnPreviewMath.description,
    timings,
    samples,
    scope:
      "Whole native birth and pool insertion executed in browser-compatible WASM via CLI, compared against pristine-byte-checked native Unicorn on controlled inputs. Three strict static emitter graphs, explicit seeds/clock/poses, owned allocator/TLS/math. No particle ageing, replay clock/seed/order, attachment, shader, browser rendering or synchronized A/V claim.",
  };
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    graphs: result.graphs,
    cases: result.cases,
    steps,
    births,
    poolBytes,
    matches,
    repeatMatches,
    mismatches: mismatches.length,
    firstMismatch: mismatches[0],
  }),
);
if (mismatches.length) process.exitCode = 1;
