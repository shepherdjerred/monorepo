// Exact source spans for a scoped original typed-property map observation.
import path from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
const [fileArg, expected, classArg, fieldArg, keyArg, output] =
  process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun prepare-native-bin-map-input.mjs <source.bin> <sha256> <class-name-or-hash> <field-name-or-hash> <lookup-key-u32> <output>",
  );
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const bytes = await Bun.file(fileArg).bytes();
if (!/^[a-f0-9]{64}$/.test(expected) || sha(bytes) !== expected)
  throw Error("Original BIN digest differs");
const classHash = /^[a-f0-9]{8}$/.test(classArg)
  ? classArg
  : mapBinHash(classArg);
const fieldHash = /^[a-f0-9]{8}$/.test(fieldArg)
  ? fieldArg
  : mapBinHash(fieldArg);
const key = Number(keyArg);
if (!Number.isInteger(key) || key < 0 || key > 0xffffffff)
  throw Error("Unsigned original map key required");
const tree = readExactMapBin(bytes, "16.21.829.8620", {
    captureFieldSpans: true,
  }),
  cases = [];
function visit(node, ownerPath, trail) {
  if (!node || typeof node !== "object") return;
  if (
    node.classHash === classHash &&
    node.fields?.[fieldHash]?.type === "Map"
  ) {
    const map = node.fields[fieldHash],
      matches = map.entries.filter((entry) => entry.key.value === key);
    if (matches.length > 1)
      cases.push({
        ownerPath,
        trail,
        classHash,
        fieldHash,
        entries: map.entries.length,
        originalEntries: map.entries.map((entry) => ({
          key: entry.key.value,
          classHash: entry.value.classHash,
        })),
        matchingEntries: matches,
        fields: node.fieldSpans.map((span) => ({
          ...span,
          sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
        })),
      });
  }
  if (Array.isArray(node))
    node.forEach((child, index) => visit(child, ownerPath, [...trail, index]));
  else
    for (const [name, child] of Object.entries(node))
      if (!["fieldSpans", "matchingEntries"].includes(name))
        visit(child, ownerPath, [...trail, name]);
}
for (const node of tree.objects) visit(node, node.pathHash, []);
if (!cases.length || cases.length > 128)
  throw Error("Bounded original duplicate-key cases required");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-duplicate-bin-map-input",
      build: tree.build,
      protocol: "20e09df23c66b85e",
      source: {
        file: path.resolve(fileArg),
        sha256: expected,
        bytes: bytes.length,
      },
      key,
      classHash,
      fieldHash,
      cases,
      preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
      readerSha256: sha(
        await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
      ),
      scope: {
        originalNativeReaderExecuted: false,
        duplicateResolutionAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: path.resolve(output),
    cases: cases.length,
    classHash,
    fieldHash,
    entries: cases.map((value) => value.entries),
    duplicateClasses: cases.map((value) =>
      value.matchingEntries.map((entry) => entry.value.classHash),
    ),
  }),
);
