// Name/attribute dependency projection for the original BuffData registry path.
// Authored script-data name overrides remain unavailable until their reader is
// independently supplied; they never receive a guessed empty/default value.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readExactMapBin } from "./exact-map-bin.mjs";
const [metadataArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-native-buff-registry-input.mjs <native-buff-metadata-input.json> <output.json>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    hash = sha(bytes);
  assert(
    !inputs[path] || inputs[path] === hash,
    "Buff registration source changed",
  );
  inputs[path] = hash;
  return bytes;
}
const metadataBytes = await raw(metadataArg),
  metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
assert.equal(metadata.kind, "original-native-buff-metadata-field-input");
assert.equal(metadata.build, "16.21.829.8620");
assert.equal(metadata.protocol, "20e09df23c66b85e");
for (const [file, expected] of Object.entries(metadata.inputs))
  assert.equal(sha(await raw(file)), expected);
assert.equal(
  metadata.preparerSha256,
  sha(
    await raw(
      fileURLToPath(
        new URL("prepare-native-buff-metadata-input.mjs", import.meta.url),
      ),
    ),
  ),
);
const trees = new Map(),
  records = [],
  unavailable = [];
for (const row of metadata.roots) {
  if (!trees.has(row.sourceSha256)) {
    const bytes = await raw(row.source.file);
    assert.equal(sha(bytes), row.sourceSha256);
    trees.set(row.sourceSha256, {
      bytes,
      tree: readExactMapBin(bytes, metadata.build, { captureFieldSpans: true }),
    });
  }
  const { bytes, tree } = trees.get(row.sourceSha256),
    roots = tree.objects.filter(
      (object) => object.pathHash === row.ownerPathHash,
    );
  assert.equal(roots.length, 1);
  const owner = roots[0];
  assert.equal(owner.classHash, "5e7e5a06");
  if (Object.hasOwn(owner.fields, "203e6faa")) {
    unavailable.push({
      sourceSha256: row.sourceSha256,
      ownerPathHash: row.ownerPathHash,
      reason: "authored-script-data-name-override-not-projected",
    });
    continue;
  }
  const fields = [];
  for (const hash of ["e095d841", "c8e37ef0", "34cdd819"]) {
    const value = owner.fields[hash],
      spans = owner.fieldSpans.filter((span) => span.fieldHash === hash);
    assert.equal(spans.length, value === undefined ? 0 : 1);
    if (value === undefined) continue;
    assert.equal(value.type, "String");
    assert.equal(typeof value.value, "string");
    assert(
      value.value.length <= 4096 && /^[\x01-\x7f]*$/.test(value.value),
      "Explicit bounded ASCII authored buff name required",
    );
    fields.push({
      ...spans[0],
      sha256: sha(
        bytes.subarray(spans[0].offset, spans[0].offset + spans[0].bytes),
      ),
      expectedValue: value.value,
    });
  }
  records.push({ ...row, nameFields: fields });
}
for (const [file, expected] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), expected);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-buff-registry-projection-input",
      build: metadata.build,
      protocol: metadata.protocol,
      decoderImageSha256: metadata.decoderImageSha256,
      metadataInputSha256: sha(metadataBytes),
      inputs,
      sources: {
        preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
        readerSha256: sha(
          await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
        ),
      },
      records,
      unavailable,
      scope: {
        selectedNameAndAttributeDependenciesOnly: true,
        allOtherAuthoredFieldsRetainedInRawSource: true,
        originalResourceContextResolved: false,
        buffMembershipEstablished: false,
        liveProviderAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    records: records.length,
    unavailable: unavailable.length,
  }),
);
