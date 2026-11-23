import path from "node:path";
import { validateActorRequest } from "./archived-actor-bin.mjs";
import { actorSha256 } from "./archived-actor-sources.mjs";

const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length || inputs.length > 100)
  throw Error(
    "Usage: bun create-archived-actor-request.mjs <output.json> <decoded-hero-report.json|map11-placeable-inventory.json>...",
  );
const actors = new Map(),
  provenance = [];
function add(actor) {
  const key = `${actor.character.toLowerCase()}/${actor.skinId}`;
  if (actors.has(key)) {
    const previous = actors.get(key);
    if (previous.role !== actor.role || previous.wad !== actor.wad)
      throw Error("Conflicting source roles for the same actor skin");
    previous.characterRecords = [
      ...new Set([...previous.characterRecords, ...actor.characterRecords]),
    ].sort();
  } else actors.set(key, actor);
}
for (const file of inputs) {
  const bytes = await Bun.file(file).bytes(),
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (data.build !== "16.21.829.8620")
    throw Error("Exact original 16.21 source report required");
  if (data.kind === "original-full-match-structural-decoding") {
    if (
      data.protocol !== "20e09df23c66b85e" ||
      !Array.isArray(data.heroes) ||
      data.heroes.length !== 10 ||
      !/^[a-f\d]{64}$/.test(data.replaySha256)
    )
      throw Error("Original decoded 5v5 hero report required");
    for (const hero of data.heroes) {
      if (
        typeof hero.champion !== "string" ||
        !Number.isSafeInteger(hero.skinId)
      )
        throw Error("Decoded hero has no exact skin selection");
      add({
        character: hero.champion,
        skinId: hero.skinId,
        role: "champion",
        characterRecords: [`Characters/${hero.champion}/CharacterRecords/Root`],
      });
    }
    provenance.push({
      path: path.resolve(file),
      sha256: actorSha256(bytes),
      kind: data.kind,
      replaySha256: data.replaySha256,
      rosterSource:
        "Original decoded hero packet names/skin IDs; no slot-to-metadata association is used",
      characterRecordScope:
        "Original root record must exist; runtime form selection remains separate",
    });
  } else if (data.kind === "archived-map11-placeable-inventory") {
    if (
      !Array.isArray(data.assetRequests) ||
      !/^[a-f\d]{64}$/.test(data.sourceSha256) ||
      !/^[a-f\d]{64}$/.test(data.mapDefinitionSha256)
    )
      throw Error("Original Map11 typed placeable inventory required");
    for (const actor of data.assetRequests)
      add({
        character: actor.character,
        skinId: actor.skinId,
        role: "world",
        characterRecords: actor.records,
        wad: "DATA/FINAL/Maps/Shipping/Map11.wad.client",
      });
    provenance.push({
      path: path.resolve(file),
      sha256: actorSha256(bytes),
      kind: data.kind,
      sourceSha256: data.sourceSha256,
      mapDefinitionSha256: data.mapDefinitionSha256,
      existenceScope:
        "Static source candidates only; replay entity existence is not inferred",
    });
  } else throw Error("Unsupported original actor-request source report");
}
const request = {
  schema: 1,
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  actors: [...actors.values()].sort((a, b) =>
    `${a.character}/${a.skinId}`.localeCompare(`${b.character}/${b.skinId}`),
  ),
  provenance,
};
validateActorRequest(request);
await Bun.write(path.resolve(output), JSON.stringify(request, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(output),
    actors: request.actors.length,
    sha256: actorSha256(
      new TextEncoder().encode(JSON.stringify(request, null, 2)),
    ),
  }),
);
