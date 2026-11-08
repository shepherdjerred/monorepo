import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
import { restoreEffectJsonSource } from "./effect-json-source.mjs";

// Offline candidate only: keep the active effect and dependent GPU/resource
// packages intact until their complete content-hash graph can be regenerated.
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const outputRoot = resolve(cache, "research/effect-json-candidate");
const inputs = {};
async function raw(path, expected) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (
    (expected && hash !== expected) ||
    (inputs[path] && inputs[path] !== hash)
  )
    throw Error(`Effect JSON candidate input differs: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const packagePath = resolve(cache, "public/latest-effects/package.json");
const manifestPath = resolve(cache, "public/latest-effects/manifest.json");
const previous = decode(await raw(packagePath));
const manifest = decode(await raw(manifestPath));
if (
  previous.build !== "16.21.829.8620" ||
  previous.protocol !== "20e09df23c66b85e" ||
  manifest.build !== previous.build ||
  manifest.protocol !== previous.protocol ||
  !/^[0-9a-f]{64}$/.test(previous.toolchain.parserIdentity)
)
  throw Error("Exact-build original effect package provenance required");
await raw(
  resolve(import.meta.dir, "parse-latest-assets.py"),
  previous.toolchain.parserSha256,
);
for (const [name, hash] of Object.entries(previous.toolchain.dictionaries))
  await raw(resolve(cache, `vfx/hashes.${name}.txt`), hash);
const sourceActors = new Map(
  Object.entries(previous.actors).map(([id, actor]) => [
    id,
    new Map(actor.sourceBins.map((source) => [source.path, source])),
  ]),
);
const parsed = new Map();
async function source(actor, path) {
  const record = sourceActors.get(actor)?.get(path);
  if (
    !record ||
    !/^[0-9a-f]{64}$/.test(record.sourceSha256) ||
    !/^[0-9a-f]{64}$/.test(record.jsonSha256)
  )
    throw Error(
      `Effect source has no original actor provenance: ${actor}:${path}`,
    );
  const key = `${record.sourceSha256}-${previous.toolchain.parserIdentity.slice(0, 16)}`;
  if (!parsed.has(key)) {
    const prefix = resolve(cache, `research/latest-effects/bins/${key}`);
    await raw(`${prefix}.bin`, record.sourceSha256);
    parsed.set(key, decode(await raw(`${prefix}.json`, record.jsonSha256)));
  }
  return { path, data: parsed.get(key) };
}
const candidate = structuredClone(previous),
  definitions = {},
  outputs = new Map();
const changed = [],
  counts = { definitions: 0, numbers: 0, restoredZeroSigns: 0 };
for (const collection of ["effects", "linkedDefinitions"]) {
  for (const [id, prepared] of Object.entries(previous[collection])) {
    const ref = manifest.definitions[id];
    if (
      !ref ||
      typeof ref.file !== "string" ||
      ref.file.includes("..") ||
      !ref.file.startsWith("definitions/")
    )
      throw Error(`Missing original effect manifest reference: ${id}`);
    const published = decode(
      await raw(resolve(cache, "public/latest-effects", ref.file), ref.sha256),
    );
    if (stringifyAssetJson(published) !== stringifyAssetJson(prepared))
      throw Error(`Effect package and individual definition disagree: ${id}`);
    const sources = await Promise.all(
      prepared.sourceBins.map((path) => source(prepared.actor, path)),
    );
    const restored = restoreEffectJsonSource(prepared, sources);
    const record = { ...prepared, definition: restored.definition };
    const text = stringifyAssetJson(record),
      hash = await sha256(new TextEncoder().encode(text));
    const file = `definitions/${hash}.json`;
    if (restored.restored.length === 0 && hash !== ref.sha256)
      throw Error(`Unchanged effect unexpectedly changed encoding: ${id}`);
    candidate[collection][id] = record;
    definitions[id] = { ...ref, file, sha256: hash };
    outputs.set(file, text);
    counts.definitions++;
    counts.numbers += restored.counts.numbers;
    counts.restoredZeroSigns += restored.restored.length;
    if (restored.restored.length)
      changed.push({
        id,
        beforeSha256: ref.sha256,
        afterSha256: hash,
        restored: restored.restored,
      });
  }
}
if (
  Object.keys(definitions).length !== Object.keys(manifest.definitions).length
)
  throw Error("Candidate cannot omit original published definitions");
candidate.toolchain = {
  ...previous.toolchain,
  preparerSha256: inputs[resolve(import.meta.path)],
  preparationPolicy: "verified-cached-bin-json-rebuild-v1",
  assetJsonPolicy: "finite-numeric-json-preserve-signed-zero-v1",
  assetJsonSha256: inputs[resolve(import.meta.dir, "asset-json.mjs")],
  effectSourceRestorationSha256:
    inputs[resolve(import.meta.dir, "effect-json-source.mjs")],
  sourcePackageSha256: inputs[packagePath],
  sourceManifestSha256: inputs[manifestPath],
  sourcePreparationToolchain: previous.toolchain,
};
outputs.set("package.json", stringifyAssetJson(candidate));
outputs.set(
  "manifest.json",
  stringifyAssetJson({
    ...manifest,
    toolchain: candidate.toolchain,
    definitions,
  }),
);
await mkdir(resolve(outputRoot, "definitions"), { recursive: true });
const outputHashes = {};
for (const [file, text] of outputs) {
  const path = resolve(outputRoot, file),
    expected = await sha256(new TextEncoder().encode(text));
  await Bun.write(path, text);
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Effect candidate output readback differs: ${file}`);
  outputHashes[file] = expected;
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Effect candidate input changed during preparation: ${path}`);
const output = resolve(
  cache,
  "research/effect-json-candidate-preparation.json",
);
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "offline-effect-json-signed-zero-candidate",
      build: previous.build,
      protocol: previous.protocol,
      inputs,
      outputRoot,
      outputHashes,
      counts,
      changedDefinitions: changed,
      scope: {
        onlyZeroSignSourceDifferencesAllowed: true,
        originalRawAndParsedBinHashesVerified: true,
        originalTypedLoaderExecuted: false,
        activeRuntimeAssetsReplaced: false,
        dependentGpuAndResolverPackagesRegenerated: false,
        candidateContainsCopiedTexturesAndMeshes: false,
        runtimeReady: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    outputRoot,
    counts,
    changedDefinitions: changed.length,
    sources: parsed.size,
    outputs: outputs.size,
    inputs: Object.keys(inputs).length,
  }),
);
