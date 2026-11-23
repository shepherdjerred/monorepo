// Source availability only. A decoded character/skin is not evidence that an
// actor owns a visible mesh or that an archive path is its native routing rule.
import {
  openArchivedActorSources,
  actorSha256,
} from "./archived-actor-sources.mjs";
import {
  validateActorRequest,
  actorObjectHash,
} from "./archived-actor-bin.mjs";

const [parserCheckout, sourceCache, archiveCache, requestFile, output] =
  process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun inspect-archived-actor-availability.mjs <parser-checkout> <approved-source-cache> <archive-cache> <request.json> <output.json>",
  );
const bytes = await Bun.file(requestFile).bytes(),
  request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const actors = validateActorRequest(request),
  source = await openArchivedActorSources({
    parserCheckout,
    sourceCache,
    archiveCache,
  }),
  records = [];
for (const actor of actors) {
  const wad =
      actor.wad ??
      (actor.role === "champion"
        ? `DATA/FINAL/Champions/${actor.character}.wad.client`
        : "DATA/FINAL/Maps/Shipping/Map11.wad.client"),
    archive = await source.wad(wad);
  const skinFile = `data/characters/${actor.character.toLowerCase()}/skins/skin${actor.skinId}.bin`,
    characterFile = `data/characters/${actor.character.toLowerCase()}/${actor.character.toLowerCase()}.bin`;
  const record = {
    character: actor.character,
    skinId: actor.skinId,
    wad,
    skinFile,
    characterFile,
    skinFilePresent: archive.has(skinFile),
    characterFilePresent: archive.has(characterFile),
    characterRecords: actor.characterRecords,
  };
  if (record.skinFilePresent) {
    const bin = await source.bin(wad, skinFile),
      wanted = actorObjectHash(
        `Characters/${actor.character}/Skins/Skin${actor.skinId}`,
      ),
      found = Object.entries(bin.normalized).find(
        ([key]) => actorObjectHash(key) === wanted,
      );
    record.skin = {
      sourceSha256: actorSha256(bin.bytes),
      exactObjectPresent: !!found,
      class: found?.[1].__type ?? null,
      mesh: found?.[1].skinMeshProperties ?? null,
      animationGraph:
        found?.[1].skinAnimationProperties?.animationGraphData ?? null,
    };
  }
  if (record.characterFilePresent) {
    const bin = await source.bin(wad, characterFile);
    record.characterDefinition = {
      sourceSha256: actorSha256(bin.bytes),
      recordsPresentInThisFile: actor.characterRecords.filter((value) =>
        Object.keys(bin.normalized).some(
          (key) => actorObjectHash(key) === actorObjectHash(value),
        ),
      ),
      dependencies: bin.tree.dependencies,
    };
  }
  records.push(record);
}
const result = {
  schema: 1,
  kind: "archived-original-actor-source-availability",
  build: request.build,
  protocol: request.protocol,
  requestSha256: actorSha256(bytes),
  scope:
    "Presence in explicitly requested archives only; absent paths do not establish native routing or invisible-actor policy",
  records,
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  spectatorAdmission: false,
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    actors: records.length,
    skinFilesPresent: records.filter((value) => value.skinFilePresent).length,
    characterFilesPresent: records.filter((value) => value.characterFilePresent)
      .length,
    spectatorAdmission: false,
  }),
);
