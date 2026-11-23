// Exact original CharacterRecord scalars consumed by replication/corpse code.
import path from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";

const [manifestArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-native-world-records-input.mjs <actor-objects/manifest.json> <output.json>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  bytes = await Bun.file(manifestArg).bytes(),
  manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
if (
  manifest.schema !== 1 ||
  manifest.kind !== "archived-original-actor-object-owners" ||
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e" ||
  manifest.spectatorAdmission !== false ||
  !Array.isArray(manifest.records) ||
  !manifest.records.length ||
  manifest.records.length > 2048
)
  throw Error("Exact archived actor object availability required");
const names = ["minionFlags", "healthBarHeight", "deathTime"],
  hashes = new Set(names.map(mapBinHash)),
  roots = [],
  seen = new Set();
for (const record of manifest.records) {
  const key = `${record.character.toLowerCase()}/${record.resourceSkinId}`;
  if (
    !/^[a-z0-9_]+$/i.test(record.character) ||
    !Number.isInteger(record.resourceSkinId) ||
    record.resourceSkinId < 0 ||
    record.resourceSkinId > 0xffffffff ||
    seen.has(key) ||
    record.unresolved.length
  )
    throw Error("Unique resolved original actor identity required");
  seen.add(key);
  const reference = `Characters/${record.character}/CharacterRecords/Root`,
    owners = record.objects.filter(
      (object) =>
        object.reference === reference &&
        object.className === "CharacterRecord",
    );
  if (owners.length !== 1)
    throw Error("Unique original CharacterRecord owner required");
  const owner = owners[0];
  if (owner.output !== `original-${owner.sourceSha256}.bin`)
    throw Error("Content-addressed original CharacterRecord owner required");
  const file = path.resolve(
      path.dirname(manifestArg),
      record.character.toLowerCase(),
      String(record.resourceSkinId),
      owner.output,
    ),
    raw = await Bun.file(file).bytes();
  if (sha(raw) !== owner.sourceSha256)
    throw Error("Original CharacterRecord source digest differs");
  const tree = readExactMapBin(raw, manifest.build, {
      captureFieldSpans: true,
    }),
    nodes = tree.objects.filter(
      (node) => node.pathHash === mapBinHash(reference),
    );
  if (
    nodes.length !== 1 ||
    nodes[0].classHash !== mapBinHash("CharacterRecord")
  )
    throw Error("Exact original CharacterRecord namespace/class required");
  const node = nodes[0],
    fields = node.fieldSpans.filter((span) => hashes.has(span.fieldHash));
  roots.push({
    key,
    character: record.character,
    resourceSkinId: record.resourceSkinId,
    reference,
    typeHash: node.classHash,
    identity: node.pathHash,
    source: { file, sha256: sha(raw), bytes: raw.length },
    fields: fields.map((span) => ({
      ...span,
      sha256: sha(raw.subarray(span.offset, span.offset + span.bytes)),
    })),
    originalSelectedFields: Object.fromEntries(
      names.map((name) => [name, node.fields[mapBinHash(name)] ?? null]),
    ),
  });
}
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-native-world-character-record-input",
      build: manifest.build,
      protocol: manifest.protocol,
      manifest: { file: path.resolve(manifestArg), sha256: sha(bytes) },
      requestSha256: manifest.requestSha256,
      roots,
      preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
      readerSha256: sha(
        await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
      ),
      scope: {
        selectedOriginalScalarFieldsOnly: true,
        nativeReaderExecuted: false,
        fullCharacterLoaded: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output: path.resolve(outputArg), roots: roots.length }),
);
