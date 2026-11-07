import { resolve } from "node:path";
import { stringifyAssetJson } from "./asset-json.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
async function raw(path, expected) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  const digest = await sha256(bytes);
  if (
    (expected && expected !== digest) ||
    (inputs[path] && inputs[path] !== digest)
  )
    throw Error(`Static JSON source differs: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await raw(import.meta.path);
await raw(resolve(import.meta.dir, "asset-json.mjs"));
await raw(resolve(import.meta.dir, "../structural-comparison.mjs"));
const metadata = decode(
  await raw(`${cache}/public/latest-effects/package.json`),
);
if (
  metadata.build !== "16.21.829.8620" ||
  metadata.protocol !== "20e09df23c66b85e" ||
  !/^[0-9a-f]{64}$/.test(metadata.toolchain.parserIdentity)
)
  throw Error("Exact-build parsed BIN provenance required");
const sources = new Map();
for (const actor of Object.values(metadata.actors)) {
  for (const source of actor.sourceBins) {
    if (
      !/^[0-9a-f]{64}$/.test(source.sourceSha256) ||
      !/^[0-9a-f]{64}$/.test(source.jsonSha256)
    )
      throw Error("Exact raw/parsed BIN identities required");
    const prior = sources.get(source.sourceSha256);
    if (prior && prior.jsonSha256 !== source.jsonSha256)
      throw Error("One raw BIN has conflicting parsed provenance");
    sources.set(source.sourceSha256, source);
  }
}
const counts = {
  sources: sources.size,
  numbers: 0,
  negativeZeros: 0,
  ordinaryJsonLostSigns: 0,
};
const examples = [];
function compare(source, encoded, ordinary, path, sourcePath) {
  if (typeof source === "number") {
    counts.numbers++;
    if (!Object.is(source, encoded))
      throw Error(`Numeric JSON round-trip differs: ${sourcePath}:${path}`);
    if (Object.is(source, -0)) {
      counts.negativeZeros++;
      if (!Object.is(ordinary, -0)) {
        counts.ordinaryJsonLostSigns++;
        if (examples.length < 64) examples.push({ sourcePath, path });
      }
    }
    return;
  }
  if (source === null || typeof source !== "object") {
    if (source !== encoded)
      throw Error(`JSON value round-trip differs: ${sourcePath}:${path}`);
    return;
  }
  if (
    Array.isArray(source) !== Array.isArray(encoded) ||
    JSON.stringify(Object.keys(source)) !== JSON.stringify(Object.keys(encoded))
  )
    throw Error(`JSON structure round-trip differs: ${sourcePath}:${path}`);
  for (const key of Object.keys(source))
    compare(
      source[key],
      encoded[key],
      ordinary[key],
      `${path}/${key}`,
      sourcePath,
    );
}
for (const source of sources.values()) {
  const prefix = `${cache}/research/latest-effects/bins/${source.sourceSha256}-${metadata.toolchain.parserIdentity.slice(0, 16)}`;
  await raw(`${prefix}.bin`, source.sourceSha256);
  const parsed = decode(await raw(`${prefix}.json`, source.jsonSha256));
  compare(
    parsed,
    JSON.parse(stringifyAssetJson(parsed)),
    JSON.parse(JSON.stringify(parsed)),
    "",
    source.path,
  );
}
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Static JSON input changed: ${path}`);
const output = `${cache}/research/asset-json-signed-zero-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "prepared-bin-json-numeric-serialization-comparison",
      inputs,
      policy: "finite-numeric-json-preserve-signed-zero-v1",
      counts,
      lostSignExamples: examples,
      mismatches: [],
      scope: {
        preparedParserOutputsCompared: true,
        originalBinHashesVerified: true,
        originalTypedLoaderCompared: false,
        runtimeAssetPackagesRegenerated: false,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output, counts, inputs: Object.keys(inputs).length }),
);
