// Full original property bytes for source BuffData objects whose original
// attribute getter tested true. This does not identify active replay buffs.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
const [inputArg, proofArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 5)
  throw Error(
    "Usage: bun prepare-native-homeguard-source-input.mjs <buff-registry-projection-input.json> <original-registry-controls.json> <output.json>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    digest = sha(bytes);
  assert(!inputs[path] || inputs[path] === digest, "Homeguard source changed");
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const inputBytes = await raw(inputArg),
  input = decode(inputBytes),
  proofBytes = await raw(proofArg),
  proof = decode(proofBytes);
assert.equal(input.kind, "original-buff-registry-projection-input");
assert.equal(proof.kind, "original-archived-buff-registry-observation");
assert.equal(proof.inputSha256, sha(inputBytes));
assert.equal(proof.boundary, null);
assert.equal(proof.scope.originalHashAndTwoIndexLookupCompared, true);
assert.equal(proof.cases.length, input.records.length);
for (const [file, expected] of Object.entries({
  ...input.inputs,
  ...proof.sources,
}))
  assert.equal(sha(await raw(file)), expected);
const records = [];
for (const observed of proof.cases.filter((row) => row.originalMask2Result)) {
  const matching = input.records.filter(
    (row) =>
      row.sourceSha256 === observed.sourceSha256 &&
      row.ownerPathHash === observed.ownerPathHash,
  );
  assert.equal(matching.length, 1);
  const record = matching[0],
    bytes = await raw(record.source.file),
    roots = readExactMapBin(bytes, input.build, {
      captureFieldSpans: true,
    }).objects.filter((row) => row.pathHash === record.ownerPathHash);
  assert.equal(roots.length, 1);
  const owner = roots[0];
  assert.equal(owner.classHash, "5e7e5a06");
  assert(
    !Object.hasOwn(owner.fields, "203e6faa"),
    "Authored name override requires its original full reader",
  );
  const spans = owner.fieldSpans.filter((span) =>
    ["e095d841", "c8e37ef0", "34cdd819", "7f0f5a79"].includes(span.fieldHash),
  );
  assert.equal(spans.filter((span) => span.fieldHash === "7f0f5a79").length, 1);
  records.push({
    sourceSha256: record.sourceSha256,
    ownerPathHash: record.ownerPathHash,
    registeredName: observed.registeredName,
    resourceNameHash: observed.resourceNameHash,
    source: record.source,
    expectedAttributeByte: record.expectedAttributeByte,
    fields: spans.map((span) => ({
      ...span,
      sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
    })),
  });
}
assert(records.length > 0 && records.length <= 10000);
for (const [file, expected] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), expected);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-homeguard-source-full-buff-property-input",
      build: input.build,
      protocol: input.protocol,
      decoderImageSha256: input.decoderImageSha256,
      registryProofSha256: sha(proofBytes),
      inputs,
      records,
      preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
      readerSha256: sha(
        await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
      ),
      scope: {
        completeAuthoredBuffPropertyBytesSelected: true,
        selectedNamesFromOriginalRegistryControls: true,
        activeReplayBuffsIdentified: false,
        liveProviderAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output: resolve(outputArg), records: records.length }),
);
