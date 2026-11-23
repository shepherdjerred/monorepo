import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  openArchivedActorSources,
  actorSha256,
} from "./archived-actor-sources.mjs";
import { validateActorRequest } from "./archived-actor-bin.mjs";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { findArchivedActorObjects } from "./archived-actor-object-search.mjs";

const [parserCheckout, sourceArg, cacheArg, requestFile] =
  process.argv.slice(2);
if (!requestFile)
  throw Error(
    "Usage: bun inspect-archived-actor-objects.mjs <parser-checkout> <approved-source-cache> <archive-cache> <actor-request.json>",
  );
const requestBytes = await Bun.file(requestFile).bytes(),
  request = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(requestBytes),
  ),
  actors = validateActorRequest(request);
const { out, sourceCache, cache } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "actor-objects-", directory: "actor-objects" },
);
const source = await openArchivedActorSources({
    parserCheckout,
    sourceCache,
    archiveCache: cache,
  }),
  records = [],
  tools = {};
for (const file of [
  "inspect-archived-actor-objects.mjs",
  "archived-actor-object-search.mjs",
  "archived-actor-sources.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-native-maps.mjs",
  "map-scene-assets.mjs",
  "map-scene-output.mjs",
  "exact-map-bin.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
])
  tools[file] = actorSha256(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
for (const actor of actors) {
  const lower = actor.character.toLowerCase(),
    wad =
      actor.wad ??
      (actor.role === "champion"
        ? `DATA/FINAL/Champions/${actor.character}.wad.client`
        : "DATA/FINAL/Maps/Shipping/Map11.wad.client"),
    archive = await source.wad(wad);
  const targets = [
    {
      reference: `Characters/${actor.character}/Skins/Skin${actor.skinId}`,
      className: "SkinCharacterDataProperties",
    },
    ...actor.characterRecords.map((reference) => ({
      reference,
      className: "CharacterRecord",
    })),
  ];
  const seeds = [
    `data/characters/${lower}/${lower}.bin`,
    `data/characters/${lower}/skins/skin${actor.skinId}.bin`,
    `data/characters/${lower}/skins/skin0.bin`,
  ];
  const result = await findArchivedActorObjects({
      source,
      archive,
      wad,
      seeds,
      targets,
    }),
    directory = path.join(out, lower, String(actor.skinId));
  await mkdir(directory, { recursive: true });
  const objects = [];
  for (const { target, file, bin, normalized } of result.found.values()) {
    const sha256 = actorSha256(bin.bytes),
      output = `original-${sha256}.bin`;
    await Bun.write(path.join(directory, output), bin.bytes);
    objects.push({
      reference: target.reference,
      className: target.className,
      file,
      sourceSha256: sha256,
      output,
      normalized,
    });
  }
  records.push({
    character: actor.character,
    resourceSkinId: actor.skinId,
    wad,
    objects,
    unresolved: result.unresolved,
    missingPhysicalCandidatesOrDependencies: result.missing,
    files: result.files.map((bin) => ({
      file: bin.file,
      sourceSha256: actorSha256(bin.bytes),
      dependencies: bin.tree.dependencies,
    })),
    scope:
      "Exact object owners in requested archive only; no absent object or skin substitution",
  });
}
for (const [file, digest] of Object.entries(tools))
  if (
    actorSha256(await Bun.file(new URL(file, import.meta.url)).bytes()) !==
    digest
  )
    throw Error(`Actor object inspection source changed: ${file}`);
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "archived-original-actor-object-owners",
      build: request.build,
      protocol: request.protocol,
      requestSha256: actorSha256(requestBytes),
      requestProvenance: request.provenance ?? null,
      records,
      tools,
      provenance: source.provenance(),
      rmanReceipts: source.receipts(),
      spectatorAdmission: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: out,
    actors: records.length,
    unresolvedObjects: records.reduce(
      (sum, record) => sum + record.unresolved.length,
      0,
    ),
    spectatorAdmission: false,
  }),
);
