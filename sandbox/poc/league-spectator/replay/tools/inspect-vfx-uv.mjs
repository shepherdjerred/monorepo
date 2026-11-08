import { resolve } from "node:path";
import { createLatestVfxUv } from "../latest-vfx-uv.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error("Usage: bun inspect-vfx-uv.mjs <decoder> <native> <comparison>");
const root = resolve(packagePath);
const hash = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const profile = await Bun.file(`${root}/profile.json`).json();
const bytes = await Bun.file(`${root}/vfx-uv.json`).arrayBuffer();
const nativeBytes = await Bun.file(nativePath).arrayBuffer();
const native = JSON.parse(new TextDecoder().decode(nativeBytes));
if (
  hash(bytes) !== profile.vfxUvSha256 ||
  native.definitionSha256 !== profile.vfxUvSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest
)
  throw Error("UV comparison identity mismatch");
const uv = createLatestVfxUv(JSON.parse(new TextDecoder().decode(bytes)));
const mismatches = [];
const summaries = [];
for (const [kind, samples] of [
  ["controlled", native.cases],
  ["asset", native.assets],
]) {
  for (const sample of samples) {
    const actual = uv.classify(sample.input);
    if (
      actual.flags.base !== sample.flags.base ||
      actual.flags.mult !== sample.flags.mult
    )
      mismatches.push({
        kind,
        id: sample.id ?? `${sample.effectId}/${sample.emitterIndex}`,
        expected: sample.flags,
        actual,
      });
    if (kind === "asset")
      summaries.push({
        effectId: sample.effectId,
        emitterIndex: sample.emitterIndex,
        emitterName: sample.emitterName,
        flags: actual.flags,
        reasons: actual.reasons,
      });
  }
}
const spawnBytes = await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer();
if (hash(spawnBytes) !== profile.vfxSpawnSha256)
  throw Error("UV birth graph package mismatch");
const spawn = JSON.parse(new TextDecoder().decode(spawnBytes));
const checkedSpawnGraphs = [];
for (const reference of spawn.templates) {
  const graphBytes = await Bun.file(`${root}/${reference.file}`).arrayBuffer();
  if (hash(graphBytes) !== reference.sha256)
    throw Error("UV birth graph hash mismatch");
  const sample = native.assets.find(
    (asset) =>
      asset.effectId === reference.effectId &&
      asset.emitterIndex === reference.emitterIndex,
  );
  if (
    !sample ||
    sample.sourceDefinitionSha256 !== reference.sourceDefinitionSha256
  )
    throw Error("UV birth graph source mismatch");
  const graph = JSON.parse(new TextDecoder().decode(graphBytes));
  const address = graph.addresses.link + 0xe8;
  const segment = graph.segments.find(
    (s) =>
      s.address <= address && s.address + s.bytesHex.length / 2 >= address + 2,
  );
  if (!segment) throw Error("Missing UV birth graph segment");
  const offset = (address - segment.address) * 2;
  const hex = segment.bytesHex.slice(offset, offset + 4);
  const expected = `${sample.flags.base ? "01" : "00"}${sample.flags.mult ? "01" : "00"}`;
  if (hex !== expected)
    mismatches.push({
      kind: "existing-birth-graph",
      effectId: reference.effectId,
      emitterIndex: reference.emitterIndex,
      actual: hex,
      expected,
    });
  checkedSpawnGraphs.push({
    effectId: reference.effectId,
    emitterIndex: reference.emitterIndex,
    sha256: reference.sha256,
    flagsHex: hex,
  });
}
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  definitionSha256: hash(bytes),
  nativeSha256: hash(nativeBytes),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-uv.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  ...native.summary,
  originalBlocks: native.originalBlocks.length,
  checkedSpawnGraphs,
  mismatches,
  assets: summaries,
  scope: native.scope,
};
await Bun.write(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    ...native.summary,
    originalBlocks: result.originalBlocks,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length)
  throw Error("Native/JavaScript UV record admission mismatch");
