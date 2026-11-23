import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  openArchivedActorSources,
  actorSha256,
} from "./archived-actor-sources.mjs";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { loadNeutralArgumentProof } from "./neutral-argument-corpus.mjs";

// Original meta resources only; factory arguments are not resolved skin IDs.
const [parserCheckout, sourceArg, cacheArg, requestFile] =
  process.argv.slice(2);
if (!requestFile)
  throw Error(
    "Usage: bun inspect-archived-skin-meta.mjs <parser-checkout> <approved-source-cache> <archive-cache> <actor-request-or-original-factory-arguments.json>",
  );
const requestBytes = await Bun.file(requestFile).bytes(),
  request = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(requestBytes),
  );
if (
  request.schema !== 1 ||
  request.build !== "16.21.829.8620" ||
  request.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact archived16.21 character source required");
const argumentInput = [
  "original-neutral-creation-factory-arguments",
  "original-neutral-argument-proof-corpus",
].includes(request.kind)
  ? await loadNeutralArgumentProof(requestFile)
  : null;
const rows = request.actors ?? argumentInput?.requests;
if (
  !Array.isArray(rows) ||
  !rows.length ||
  rows.length > 100000 ||
  rows.some(
    (row) =>
      typeof row.character !== "string" ||
      !/^[A-Za-z][\w]{0,63}$/.test(row.character),
  )
)
  throw Error("Bounded original character identities required");
const characters = [...new Set(rows.map((row) => row.character))].sort();
if (characters.length > 256)
  throw Error("Archived character set exceeds bounds");
const { out, sourceCache, cache } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "skin-meta-", directory: "skin-meta" },
);
const source = await openArchivedActorSources({
    parserCheckout,
    sourceCache,
    archiveCache: cache,
  }),
  wad = "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  archive = await source.wad(wad),
  records = [];
const tools = {};
for (const file of [
  "inspect-archived-skin-meta.mjs",
  "archived-actor-sources.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-native-maps.mjs",
  "exact-map-bin.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
  "map-scene-output.mjs",
  "neutral-argument-corpus.mjs",
  "neutral-argument-corpus.schema.json",
])
  tools[file] = actorSha256(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
for (const character of characters) {
  const namespace = `Characters/${character}/Skins/Meta`,
    objectHash = mapBinHash(namespace),
    lower = character.toLowerCase();
  const skinIds = [
    ...new Set(
      rows
        .filter((row) => row.character === character)
        .map((row) => row.skinId),
    ),
  ];
  if (
    skinIds.some(
      (value) => !Number.isSafeInteger(value) || value < 0 || value > 100000,
    )
  )
    throw Error("Original requested skin argument required");
  // The global object namespace is not a physical BIN filename. Search original
  // character files, named skin file candidates and their declared dependency
  // edges, accepting only the exact Meta object hash/class. Including a named
  // skin0 physical file in this search does not select resource skin zero.
  const pending = [
      `data/characters/${lower}/${lower}.bin`,
      ...[...new Set([...skinIds, 0])].map(
        (id) => `data/characters/${lower}/skins/skin${id}.bin`,
      ),
    ],
    visited = new Set();
  const record = {
    character,
    wad,
    namespace,
    objectHash,
    requestedSkinArguments: skinIds,
    present: false,
    searched: [],
    missingCandidatesOrDependencies: [],
  };
  let owner;
  while (pending.length) {
    const file = pending.shift().toLowerCase();
    if (visited.has(file)) continue;
    if (visited.size >= 256)
      throw Error("Skin Meta physical BIN search exceeds dependency bounds");
    visited.add(file);
    if (!archive.has(file)) {
      record.missingCandidatesOrDependencies.push(file);
      continue;
    }
    const bin = await source.bin(wad, file, [namespace]);
    record.searched.push({
      file,
      sha256: actorSha256(bin.bytes),
      dependencies: bin.tree.dependencies,
    });
    const object = bin.tree.objects.find(
      (node) => node.pathHash === objectHash,
    );
    if (object) {
      if (object.classHash !== mapBinHash("SkinCharacterMetaDataProperties"))
        throw Error("Original Skin Meta object has unexpected native class");
      if (owner && JSON.stringify(owner.object) !== JSON.stringify(object))
        throw Error(
          "Conflicting original Skin Meta declarations across physical BINs",
        );
      owner ??= { bin, file, object };
    }
    for (const dependency of bin.tree.dependencies)
      if (!visited.has(dependency.toLowerCase())) pending.push(dependency);
  }
  if (owner) {
    const { bin, file } = owner,
      directory = path.join(out, lower);
    record.present = true;
    record.file = file;
    await mkdir(directory);
    await Bun.write(path.join(directory, "meta.bin"), bin.bytes);
    await Bun.write(
      path.join(directory, "meta-typed.json"),
      JSON.stringify(bin.tree),
    );
    await Bun.write(
      path.join(directory, "meta-normalized.json"),
      JSON.stringify(bin.normalized),
    );
    record.sourceSha256 = actorSha256(bin.bytes);
    record.objects = bin.tree.objects.map((node) => ({
      pathHash: node.pathHash,
      classHash: node.classHash,
    }));
  }
  records.push(record);
}
for (const [file, digest] of Object.entries(tools))
  if (
    actorSha256(await Bun.file(new URL(file, import.meta.url)).bytes()) !==
    digest
  )
    throw Error(`Skin meta source changed during run: ${file}`);
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "archived-original-character-skin-meta",
      build: request.build,
      protocol: request.protocol,
      requestSha256: actorSha256(requestBytes),
      records,
      tools,
      provenance: source.provenance(),
      rmanReceipts: source.receipts(),
      scope:
        "Original character skin metadata only; resource skin resolver has not executed",
      spectatorAdmission: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: out,
    characters: characters.length,
    present: records.filter((row) => row.present).length,
    spectatorAdmission: false,
  }),
);
