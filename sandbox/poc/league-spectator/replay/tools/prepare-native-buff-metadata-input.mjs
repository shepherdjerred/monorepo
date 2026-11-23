// Exact original BuffData attribute field, selected by the recovered getter's
// sole byte dependency. Other fields stay in source bytes, outside this proof.
import path from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
const [rootArg, layoutArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 5)
  throw Error(
    "Usage: bun prepare-native-buff-metadata-input.mjs <buff-sources-root> <native-layout-proof> <output.json>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
async function raw(file) {
  const absolute = path.resolve(file),
    bytes = await Bun.file(absolute).bytes(),
    digest = sha(bytes);
  if (inputs[absolute] && inputs[absolute] !== digest)
    throw Error("Buff metadata source changed");
  inputs[absolute] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const layout = decode(await raw(layoutArg));
if (
  layout.kind !== "original-buff-metadata-layout" ||
  layout.build !== "16.21.829.8620" ||
  layout.protocol !== "20e09df23c66b85e" ||
  layout.metadataClassHash !== "4633d794" ||
  layout.metadataField.hash !== 0x7f0f5a79 ||
  !layout.scope.originalU8ReaderAndCompleteAttributeGetterCompared ||
  !layout.scope.originalNestedPointerReaderExecuted
)
  throw Error("Complete original BuffData layout/getter proof required");
for (const [file, expected] of Object.entries(layout.sources))
  if (sha(await raw(file)) !== expected)
    throw Error("Native buff layout proof source differs");
const manifest = decode(await raw(path.join(rootArg, "manifest.json")));
if (
  manifest.kind !== "original-buff-source-candidate-authority" ||
  manifest.build !== layout.build ||
  manifest.protocol !== layout.protocol ||
  manifest.nativeSpectatorAdmitted !== false ||
  !Array.isArray(manifest.files)
)
  throw Error("Closed exact original buff source authority required");
const files = new Map(manifest.files.map((row) => [row.file, row]));
async function resource(file) {
  if (!/^[A-Za-z0-9_.-]+$/.test(file) || !files.has(file))
    throw Error("Declared original buff source file required");
  const bytes = await raw(path.join(rootArg, file)),
    expected = files.get(file);
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error("Original buff source file identity differs");
  return bytes;
}
const inventory = decode(await resource(manifest.inventory));
if (
  inventory.kind !== "recorded-buff-original-source-candidates" ||
  inventory.build !== layout.build ||
  inventory.protocol !== layout.protocol ||
  !Array.isArray(inventory.bins) ||
  !inventory.bins.length ||
  inventory.bins.length > 4096
)
  throw Error("Bounded exact original buff source inventory required");
const roots = [],
  absent = [],
  seen = new Set();
for (const bin of inventory.bins) {
  if (seen.has(bin.sourceSha256)) throw Error("Duplicate buff source bytes");
  seen.add(bin.sourceSha256);
  const bytes = await resource(bin.rawFile);
  if (sha(bytes) !== bin.sourceSha256)
    throw Error("Original buff BIN digest differs");
  const tree = readExactMapBin(bytes, layout.build, {
    captureFieldSpans: true,
  });
  for (const owner of tree.objects) {
    if (owner.classHash !== "5e7e5a06") continue;
    const buff = owner.fields["7f0f5a79"];
    const identity = {
      sourceSha256: bin.sourceSha256,
      ownerPathHash: owner.pathHash,
      origins: bin.origins,
      actorScopes: bin.actorScopes,
    };
    if (buff === undefined || buff.classHash === "00000000") {
      absent.push({
        ...identity,
        status:
          buff === undefined ? "mBuff-field-absent" : "mBuff-explicit-null",
      });
      continue;
    }
    if (buff.type !== "Struct" || buff.classHash !== "4633d794")
      throw Error("Original SpellObject mBuff class differs");
    const value = buff.fields["d7e2c71d"],
      spans = buff.fieldSpans.filter((row) => row.fieldHash === "d7e2c71d");
    if (
      spans.length !== (value === undefined ? 0 : 1) ||
      (value !== undefined &&
        (value.type !== "U8" ||
          !Number.isInteger(value.value) ||
          value.value < 0 ||
          value.value > 255))
    )
      throw Error("Original unique BuffData attribute U8 required");
    roots.push({
      ...identity,
      classHash: buff.classHash,
      source: {
        file: path.resolve(rootArg, bin.rawFile),
        sha256: sha(bytes),
        bytes: bytes.length,
      },
      fields: spans.map((span) => ({
        ...span,
        sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
      })),
      expectedAttributeByte: value?.value ?? 0,
      attributeSource:
        value === undefined
          ? "original-BuffData-constructor-default"
          : "original-authored-U8-field",
    });
  }
}
if (!roots.length || roots.length > 10000)
  throw Error("Bounded original BuffData roots required");
for (const [file, expected] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== expected)
    throw Error("Buff metadata input changed before publication");
const result = {
  schema: 1,
  kind: "original-native-buff-metadata-field-input",
  build: layout.build,
  protocol: layout.protocol,
  decoderImageSha256: layout.decoderImageSha256,
  layoutProof: {
    file: path.resolve(layoutArg),
    sha256: inputs[path.resolve(layoutArg)],
  },
  sourceAuthority: {
    file: path.resolve(rootArg, "manifest.json"),
    sha256: inputs[path.resolve(rootArg, "manifest.json")],
  },
  roots,
  absentMetadata: absent,
  inputs,
  preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
  readerSha256: sha(
    await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
  ),
  scope: {
    onlyRecoveredAttributeByteSelected: true,
    allOtherAuthoredFieldsRetainedInRawSource: true,
    nativeResourceIdentityResolved: false,
    nativeBuffMembershipEstablished: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(outputArg),
    roots: roots.length,
    absentMetadata: absent.length,
    authoredAttributeFields: roots.filter((row) => row.fields.length).length,
  }),
);
