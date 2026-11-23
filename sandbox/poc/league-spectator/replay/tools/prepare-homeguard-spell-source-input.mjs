// Select every original top-level property of the source-backed SpellObjects.
// This preserves mSpell/script-data inputs outside the earlier mBuff-only proof.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
const [inputArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-homeguard-spell-source-input.mjs <homeguard-full-buff-input.json> <output.json>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    hash = sha(bytes);
  assert(
    !inputs[path] || inputs[path] === hash,
    "Complete SpellObject source changed",
  );
  inputs[path] = hash;
  return bytes;
}
const inputBytes = await raw(inputArg),
  input = JSON.parse(new TextDecoder().decode(inputBytes));
assert.equal(input.kind, "original-homeguard-source-full-buff-property-input");
assert.equal(input.build, "16.21.829.8620");
assert.equal(input.protocol, "20e09df23c66b85e");
for (const [file, expected] of Object.entries(input.inputs))
  assert.equal(sha(await raw(file)), expected);
const records = [];
for (const row of input.records) {
  const bytes = await raw(row.source.file);
  assert.equal(sha(bytes), row.sourceSha256);
  const tree = readExactMapBin(bytes, input.build, { captureFieldSpans: true }),
    owners = tree.objects.filter(
      (owner) => owner.pathHash === row.ownerPathHash,
    );
  assert.equal(owners.length, 1);
  const owner = owners[0];
  assert.equal(owner.classHash, "5e7e5a06");
  records.push({
    ...row,
    fields: owner.fieldSpans.map((span) => ({
      ...span,
      sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
    })),
    authoredFieldHashes: Object.keys(owner.fields),
    sourceMSpellClassHash: owner.fields["56d2be52"]?.classHash ?? null,
    sourceScriptDataType: owner.fields["203e6faa"]?.type ?? null,
  });
}
for (const [file, expected] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), expected);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-homeguard-complete-spell-object-source-input",
      build: input.build,
      protocol: input.protocol,
      decoderImageSha256: input.decoderImageSha256,
      homeguardSourceInputSha256: sha(inputBytes),
      inputs,
      records,
      preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
      readerSha256: sha(
        await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
      ),
      scope: {
        everyOriginalSpellObjectPropertySelected: true,
        nativePendingReferencesResolved: false,
        sourceWrappersPublished: false,
        liveBuffProvidersAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    records: records.map((row) => ({
      name: row.registeredName,
      fields: row.fields.length,
      sourceMSpellClassHash: row.sourceMSpellClassHash,
      sourceScriptDataType: row.sourceScriptDataType,
    })),
  }),
);
