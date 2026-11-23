// All original shared shader roots/fields; names annotate no native ABI.
import path from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [rootArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun prepare-native-shader-global-inputs.mjs <closed-archived-shader-globals> <output.json>",
  );
const inputs = {};
async function raw(file) {
  const absolute = path.resolve(file),
    bytes = await Bun.file(absolute).bytes();
  inputs[absolute] = sha(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const manifest = JSON.parse(
  new TextDecoder().decode(await raw(path.join(rootArg, "manifest.json"))),
);
if (
  manifest.kind !== "archived-original-shader-global-declarations" ||
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact archived shader global authority required");
const source = manifest.records.find(
    (record) => record.file === "assets/shaders/shareddata.bin",
  ),
  ref = manifest.files.find((file) => file.file === source?.rawFile);
if (!source || !ref) throw Error("Original Shared shader declaration missing");
const bytes = await raw(path.join(rootArg, source.rawFile));
if (
  bytes.length !== ref.bytes ||
  sha(bytes) !== ref.sha256 ||
  sha(bytes) !== source.sourceSha256
)
  throw Error("Archived shared shader raw bytes changed");
const tree = readExactMapBin(bytes, manifest.build, {
    captureFieldSpans: true,
  }),
  classes = new Set();
function walk(value) {
  if (value === null || typeof value !== "object") return;
  if (typeof value.classHash === "string" && value.classHash !== "00000000")
    classes.add(value.classHash);
  for (const child of Object.values(value))
    if (child && typeof child === "object") walk(child);
}
walk(tree);
const roots = tree.objects.map((object) => ({
  ownerPathHash: object.pathHash,
  classHash: object.classHash,
  source: {
    file: path.resolve(rootArg, source.rawFile),
    bytes: bytes.length,
    sha256: sha(bytes),
  },
  fields: object.fieldSpans.map((field) => ({
    ...field,
    sha256: sha(bytes.subarray(field.offset, field.offset + field.bytes)),
  })),
}));
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Original shader input source changed");
const result = {
  schema: 1,
  kind: "original-shared-shader-typed-field-inputs",
  build: manifest.build,
  protocol: manifest.protocol,
  sourceAuthoritySha256: inputs[path.resolve(rootArg, "manifest.json")],
  roots,
  classHashes: [...classes].sort(),
  inputs,
  scope: {
    allOriginalRootFields: true,
    nativeTypedReaderExecuted: false,
    globalRegistryInitialized: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result));
console.log(
  JSON.stringify({
    output: outputArg,
    roots: roots.length,
    classHashes: result.classHashes,
  }),
);
