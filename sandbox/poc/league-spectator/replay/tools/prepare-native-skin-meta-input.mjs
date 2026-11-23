// Exact original metadata field spans; no final skin selection is inferred.
import { resolve, dirname } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
const [manifestArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun prepare-native-skin-meta-input.mjs <skin-meta/manifest.json> <output.json>",
  );
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const manifestBytes = await Bun.file(manifestArg).bytes();
const manifest = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
);
if (
  manifest.schema !== 1 ||
  manifest.kind !== "archived-original-character-skin-meta" ||
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e" ||
  !Array.isArray(manifest.records) ||
  !manifest.records.length ||
  manifest.records.length > 2048
)
  throw Error("Exact archived original skin metadata manifest required");
const roots = [],
  seen = new Set();
for (const item of manifest.records) {
  if (
    !/^[a-z0-9_]+$/i.test(item.character) ||
    seen.has(item.character.toLowerCase()) ||
    item.present !== true
  )
    throw Error("Unique present original skin metadata record required");
  seen.add(item.character.toLowerCase());
  const file = resolve(
    dirname(manifestArg),
    item.character.toLowerCase(),
    "meta.bin",
  );
  const bytes = await Bun.file(file).bytes();
  if (sha(bytes) !== item.sourceSha256)
    throw Error("Original skin metadata source digest differs");
  const tree = readExactMapBin(bytes, manifest.build, {
    captureFieldSpans: true,
  });
  const matches = tree.objects.filter(
    (node) =>
      node.pathHash === mapBinHash(`Characters/${item.character}/Skins/Meta`),
  );
  if (
    matches.length !== 1 ||
    matches[0].classHash !== mapBinHash("SkinCharacterMetaDataProperties")
  )
    throw Error(
      "Unique original SkinCharacterMetaDataProperties root required",
    );
  const node = matches[0];
  roots.push({
    character: item.character,
    identity: node.pathHash,
    typeHash: node.classHash,
    source: { file, bytes: bytes.length, sha256: sha(bytes) },
    fields: node.fieldSpans.map((span) => ({
      ...span,
      sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
    })),
    original: node.fields,
  });
}
const result = {
  schema: 1,
  kind: "original-native-skin-meta-field-input",
  build: manifest.build,
  protocol: manifest.protocol,
  manifest: { file: resolve(manifestArg), sha256: sha(manifestBytes) },
  requestSha256: manifest.requestSha256,
  roots,
  preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
  readerSha256: sha(
    await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
  ),
  scope: {
    originalNativeReaderExecuted: false,
    finalSkinResolutionExecuted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ output: resolve(outputArg), roots: roots.length }),
);
