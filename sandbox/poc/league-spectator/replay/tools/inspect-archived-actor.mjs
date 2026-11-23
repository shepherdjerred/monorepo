import path from "node:path";
import { openArchivedActorSources } from "./archived-actor-sources.mjs";
import { findActorObject } from "./archived-actor-bin.mjs";
import { createActorBinClosure } from "./archived-actor-closure.mjs";

const [
  parserCheckout,
  sourceCache,
  archiveCache,
  character,
  skinValue,
  output,
] = process.argv.slice(2);
if (
  !output ||
  process.argv.length !== 8 ||
  !/^[a-z\d_]+$/i.test(character) ||
  !/^\d+$/.test(skinValue)
)
  throw Error(
    "Usage: bun inspect-archived-actor.mjs <parser-checkout> <approved-source-cache> <archive-cache> <character> <skinId> <output.json>",
  );
const source = await openArchivedActorSources({
  parserCheckout,
  sourceCache,
  archiveCache,
});
const wadName = `DATA/FINAL/Champions/${character}.wad.client`;
const object = `Characters/${character}/Skins/Skin${Number(skinValue)}`;
const skin = await source.bin(
  wadName,
  `data/characters/${character.toLowerCase()}/skins/skin${Number(skinValue)}.bin`,
  [object],
);
const base = await source.bin(
  wadName,
  `data/characters/${character.toLowerCase()}/${character.toLowerCase()}.bin`,
  [`Characters/${character}/CharacterRecords/Root`],
);
const selectedSkin = findActorObject(skin.normalized, object);
const closure = createActorBinClosure(source, wadName);
await closure.load(
  `data/characters/${character.toLowerCase()}/skins/skin${Number(skinValue)}.bin`,
  [object],
);
const graphReference = selectedSkin.skinAnimationProperties?.animationGraphData;
const graph = graphReference ? await closure.resolve(graphReference) : null;
const rawBins = [];
for (const bin of closure.files()) {
  const rawFile = path.join(
    path.dirname(path.resolve(output)),
    `original-bin-${bin.tree.sourceSha256}.bin`,
  );
  await Bun.write(rawFile, bin.bytes);
  rawBins.push({
    file: bin.file,
    sha256: bin.tree.sourceSha256,
    path: rawFile,
  });
}
await Bun.write(
  path.resolve(output),
  JSON.stringify(
    {
      build: skin.tree.build,
      skin: skin.normalized,
      skinDependencies: skin.tree.dependencies,
      selectedSkin,
      graph,
      rawBins,
      character: base.normalized,
      characterDependencies: base.tree.dependencies,
      provenance: source.provenance(),
      receipts: source.receipts(),
      toolchain: source.toolchain,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: path.resolve(output),
    objects: Object.keys(skin.normalized).length,
    dependencies: skin.tree.dependencies,
    receipts: source.receipts().length,
  }),
);
