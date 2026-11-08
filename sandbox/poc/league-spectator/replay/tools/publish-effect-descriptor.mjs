// Source, native/WASM byte evidence and exact preview publication checks.
import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-effect-descriptor.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  json = async (path) => JSON.parse(new TextDecoder().decode(await read(path)));
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const nativePath = `${cache}/research/effect-descriptor-native.json`,
  proofPath = `${cache}/research/effect-descriptor-comparison.json`,
  packagePath = `${assets}/latest-effect-descriptor/package.json`,
  visualPath = `${assets}/evidence/latest-effect-descriptor.json`;
const native = await json(nativePath),
  proof = await json(proofPath),
  meta = await json(packagePath),
  visual = await json(visualPath),
  image = await read(`${decoder}/image.bin`);
requireThat(
  meta.build === "16.21.829.8620" &&
    meta.protocol === "20e09df23c66b85e" &&
    meta.decoderImageSha256 === sha(image) &&
    native.packageSha256 === sha(await read(packagePath)) &&
    proof.packageSha256 === native.packageSha256 &&
    proof.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await read(`${root}/tools/inspect-effect-descriptor.mjs`)) &&
    native.preparerSha256 ===
      sha(await read(`${root}/tools/prepare-effect-descriptor.py`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-effect-descriptor.py`)) &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-effect-descriptor.png`)) &&
    JSON.stringify(visual.counts) === JSON.stringify(proof.counts) &&
    proof.mismatches.length === 0 &&
    proof.scope.originalDescriptorPrefixExecuted &&
    proof.scope.entityPointersSuppliedZero &&
    proof.scope.inputObservationPreserved &&
    !proof.scope.resourceLookupExecuted &&
    !proof.scope.auxiliaryContextLookupExecuted &&
    !proof.scope.worldRegistryExecuted &&
    !proof.scope.factoryExecuted &&
    !proof.scope.mainViewerIntegrated &&
    !proof.scope.renderingIntegrated &&
    !proof.scope.browserRun &&
    !proof.scope.leagueReferenceCompared,
  "Descriptor evidence missing or changed",
);
for (const record of [native, proof])
  for (const [path, expected] of Object.entries(record.inputs))
    requireThat(
      sha(await read(path)) === expected,
      `Stale descriptor input: ${path}`,
    );
for (const [name, expected] of Object.entries(proof.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === expected,
    `Stale descriptor source: ${name}`,
  );
for (const block of meta.sourceBlocks)
  requireThat(
    sha(image.subarray(block.startRva, block.endRva)) === block.sha256,
    "Original descriptor block changed",
  );
const counts = {
  packetChecks: proof.counts.packetChecks,
  entryChecks: proof.records.length,
  bytesCompared: 0,
  nondefaultScalar78: 0,
  nondefaultScalar7c: 0,
  nonzeroScalarA0: 0,
  nonzeroVector6c: 0,
  flagCounts: {},
  auxiliaryContextIds: 0,
};
const scratch = new DataView(new ArrayBuffer(4)),
  bits = (value) => {
    scratch.setFloat32(0, value, true);
    return scratch.getUint32(0, true);
  };
for (const [index, record] of proof.records.entries()) {
  const expected = native.records[index],
    bytes = Buffer.from(record.descriptorHex, "hex"),
    data = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  requireThat(
    record.creationSequence === index &&
      record.entityId === expected.entityId &&
      record.groupIndex === expected.groupIndex &&
      record.entryIndex === expected.entryIndex &&
      record.descriptorHex === expected.descriptorHex &&
      bytes.length === 0xc0 &&
      record.mutatedEntryHex === expected.mutatedEntryHex &&
      JSON.stringify(record.unresolvedAuxiliaryContextIds) ===
        JSON.stringify(expected.unresolvedAuxiliaryContextIds) &&
      record.resolvedEntityPointersSuppliedZero &&
      !record.resourceLookupExecuted &&
      !record.factoryExecuted,
    "Descriptor native bytes or scope differs",
  );
  for (const [name, offset] of Object.entries(meta.wordFields))
    requireThat(
      record[name] === data.getUint32(offset, true),
      "Typed descriptor word differs",
    );
  for (const [name, offset] of Object.entries(meta.byteFields))
    requireThat(
      record.byteFields[name] === data.getUint8(offset),
      "Typed descriptor byte differs",
    );
  for (const [name, offset] of Object.entries(meta.scalarFields))
    requireThat(
      record.scalarBits[name] === data.getUint32(offset, true) &&
        bits(record[name]) === record.scalarBits[name],
      "Typed descriptor scalar differs",
    );
  requireThat(
    JSON.stringify(record.vector6cBits) ===
      JSON.stringify(expected.vector6cBits) &&
      JSON.stringify(record.vector6c.map(bits)) ===
        JSON.stringify(record.vector6cBits),
    "Typed descriptor vector differs",
  );
  counts.bytesCompared += bytes.length;
  counts.nondefaultScalar78 += record.scalarBits.scalar78 !== 0x3f800000;
  counts.nondefaultScalar7c += record.scalarBits.scalar7c !== 0x3f800000;
  counts.nonzeroScalarA0 += record.scalarBits.scalarA0 !== 0;
  counts.nonzeroVector6c += record.vector6cBits.some(
    (word) => (word & 0x7fffffff) !== 0,
  );
  counts.flagCounts[record.flags] = (counts.flagCounts[record.flags] ?? 0) + 1;
  counts.auxiliaryContextIds += record.unresolvedAuxiliaryContextIds.length;
}
requireThat(
  JSON.stringify(counts) === JSON.stringify(proof.counts) &&
    counts.entryChecks === native.counts.entries &&
    counts.bytesCompared === native.counts.descriptorBytesCompared,
  "Descriptor summaries differ from bytes",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-effect-descriptor.mjs`],
  target: "browser",
});
requireThat(
  build.success && build.outputs.length === 1,
  "Descriptor component browser-target build failed",
);
const paths = new Map();
for (const [name, path] of [
  ["effect-descriptor-native.json", nativePath],
  ["effect-descriptor-comparison.json", proofPath],
]) {
  await Bun.write(`${assets}/evidence/${name}`, await read(path));
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
}
for (const name of [
  "latest-effect-descriptor.png",
  "latest-effect-descriptor.json",
])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
for (const name of [
  "latest-effect-descriptor",
  "latest-effect-placement",
  "latest-effect-creation",
])
  paths.set(`/assets/${name}/package.json`, `${assets}/${name}/package.json`);
paths.set(
  "/assets/latest-scene/manifest.json",
  `${assets}/latest-scene/manifest.json`,
);
for (const name of ["profile.json", "image.bin", "constructors.bin"])
  paths.set(`/assets/decoder-16.21-macos/${name}`, `${decoder}/${name}`);
for (const name of ["unicorn_x86_candidate.mjs", "unicorn_x86_candidate.json"])
  paths.set(`/assets/vendor/${name}`, `${assets}/vendor/${name}`);
const visited = new Set();
async function includeModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const match of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await includeModule(resolve(dirname(file), match[1]));
}
await includeModule(`${root}/latest-effect-descriptor.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
const checks = [];
for (const origin of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [path, file] of paths) {
    const response = await fetch(`${origin}${path}`, {
        signal: AbortSignal.timeout(30000),
      }),
      expected = sha(await read(file));
    requireThat(
      response.status === 200 && sha(await response.arrayBuffer()) === expected,
      `Descriptor publication differs: ${origin}${path}`,
    );
    checks.push({ url: `${origin}${path}`, sha256: expected });
  }
await Bun.write(
  `${cache}/research/effect-descriptor-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await read(import.meta.path)),
      comparisonSha256: sha(await read(proofPath)),
      imageSha256: visual.imageSha256,
      counts,
      scope: proof.scope,
      checks,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ matchedFiles: checks.length, counts }));
