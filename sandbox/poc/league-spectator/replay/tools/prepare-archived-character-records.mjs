// Prepare original character/spell definitions before GPU actor conversion.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import {
  openArchivedActorSources,
  actorSha256 as sha,
} from "./archived-actor-sources.mjs";
import { validateActorRequest } from "./archived-actor-bin.mjs";
import { createActorBinClosure } from "./archived-actor-closure.mjs";
import { buildActorSpellCatalog } from "./archived-actor-spells.mjs";
const [parserCheckout, sourceArg, cacheArg, requestArg] = process.argv.slice(2);
if (!requestArg)
  throw Error(
    "Usage: bun prepare-archived-character-records.mjs <RMAN-parser-checkout> <approved-source-cache> <archive-cache> <actor-request>",
  );
const requestBytes = await Bun.file(requestArg).bytes(),
  request = JSON.parse(new TextDecoder().decode(requestBytes));
const actors = validateActorRequest(request);
const { out, sourceCache, cache } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "records-", directory: "latest-scene" },
);
const source = await openArchivedActorSources({
  parserCheckout,
  sourceCache,
  archiveCache: cache,
});
const profile = await Bun.file(
  path.join(sourceCache, "public/decoder-16.21-macos/profile.json"),
).json();
const namingBytes = await Bun.file(
  path.join(sourceCache, "public/decoder-16.21-macos/attack-names.json"),
).bytes();
if (
  sha(namingBytes) !== profile.attackNamingSha256 ||
  profile.clientVersion !== request.build ||
  profile.protocolDigest !== request.protocol
)
  throw Error("Original exact-build attack-name definitions required");
const attackNaming = JSON.parse(new TextDecoder().decode(namingBytes)),
  assets = {},
  tools = {};
for (const file of [
  "prepare-archived-character-records.mjs",
  "archived-actor-sources.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-closure.mjs",
  "archived-actor-spells.mjs",
  "exact-map-bin.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
  "map-scene-output.mjs",
])
  tools[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
for (const actor of actors) {
  const wad =
    actor.wad ??
    (actor.role === "world"
      ? "DATA/FINAL/Maps/Shipping/Map11.wad.client"
      : `DATA/FINAL/Champions/${actor.character}.wad.client`);
  const closure = createActorBinClosure(source, wad);
  const file = `data/characters/${actor.character.toLowerCase()}/${actor.character.toLowerCase()}.bin`;
  await closure.load(file, actor.characterRecords);
  for (const record of actor.characterRecords) await closure.resolve(record);
  const catalog = buildActorSpellCatalog({
    actor,
    objects: closure.objects(),
    attackNaming,
    attackNamingSha256: profile.attackNamingSha256,
  });
  const directory = `${actor.role === "world" ? "world" : "champions"}/${actor.key}`;
  const relative = `${directory}/spells.json`;
  await mkdir(path.join(out, directory), { recursive: true });
  await Bun.write(path.join(out, relative), JSON.stringify(catalog));
  assets[actor.key] = {
    character: actor.character,
    skinId: actor.skinId,
    spellCatalog: relative,
    characterRecords: actor.characterRecords,
    originalFiles: closure
      .files()
      .map((bin) => ({ path: bin.file, sha256: bin.tree.sourceSha256 })),
  };
}
for (const [file, digest] of Object.entries(tools))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error(`Character definition producer changed ${file}`);
const files = [];
for (const file of new Bun.Glob("**/*").scanSync({
  cwd: out,
  onlyFiles: true,
})) {
  const bytes = await Bun.file(path.join(out, file)).bytes();
  files.push({
    path: file.replaceAll("\\", "/"),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
await Bun.write(
  path.join(out, "character-records-manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "archived-original-character-records",
      build: request.build,
      protocol: request.protocol,
      requestSha256: sha(requestBytes),
      spectatorAdmission: false,
      assets,
      tools,
      attackNamingSha256: profile.attackNamingSha256,
      provenance: source.provenance(),
      rmanReceipts: source.receipts(),
      files,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: out,
    assets: Object.keys(assets).length,
    files: files.length,
    spectatorAdmission: false,
  }),
);
