import { realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { selectReviewedDragonActors } from "./research/native-terrain-dragon-actors.mjs";
import { exportNativeTerrainStructureModels } from "./native-terrain-structure-model-export.mjs";
import { openLocalWad } from "./wad.mjs";

const [installation, replayFile, decoderFile, exporter, outArg, ...extra] =
  process.argv.slice(2);
if (!outArg || extra.length)
  throw Error(
    "Usage: bun prepare-native-terrain-dragon.mjs <installation> <saved ROFL> <exact decoder> <ordinal exporter bin dir> <new .cache subdirectory>",
  );

const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Dragon output must stay in private .cache");
const destination = join(parent, basename(output));

const installedExeSha256 =
  "89d73a9e6d886c291f5b3cf42904e5e8b014148b56490d2b6c862ea96cc9f156";
const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const skins = new Map([
  [
    "sru_dragon_fire",
    "e7c85343ec3aaceec51b265a3f2ee58e19139d4a0c8e6e5f9566eff3191e87ed",
  ],
  [
    "sru_dragon_earth",
    "a18ddb1c21a076047597947d88b5be71df072bf55f29f9d88d39140c2511d0e5",
  ],
  [
    "sru_dragon_chemtech",
    "a2a52df6b4f7a1f9cd1b8733f3cf517cd8e9ee605e5cf183a844bd76a92f5b14",
  ],
]);

if (
  sha(
    await Bun.file(join(installation, "Game", "League of Legends.exe")).bytes(),
  ) !== installedExeSha256
)
  throw Error("Installed game file differs from the reviewed exact build");

const reader = fileURLToPath(
  new URL(
    "./research/verify-native-terrain-dragon-waypoints.mjs",
    import.meta.url,
  ),
);
const proof = Bun.spawnSync([
  process.execPath,
  reader,
  decoderFile,
  replayFile,
]);
if (proof.exitCode !== 0)
  throw Error(
    "Could not verify saved dragon observations: " +
      new TextDecoder().decode(proof.stderr),
  );
const {
  build,
  protocol,
  replaySha256,
  decoderSha256,
  creationTableSha256,
  subjects,
} = JSON.parse(new TextDecoder().decode(proof.stdout));
const actors = selectReviewedDragonActors(subjects, skins);
const characters = [...new Set(actors.map(({ modelId }) => modelId))];

const wad = await openLocalWad(installation, archive, Bun.zstdDecompressSync);
for (const character of characters) {
  const skin = `data/characters/${character}/skins/skin0.bin`;
  if (sha(await wad(skin)) !== skins.get(character))
    throw Error(
      `Authored ${character} skin differs from the reviewed Map11 source`,
    );
}
const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  destination,
  exporter,
  wad,
  skins: characters.map((character) => ({ character, skinId: 0 })),
  requireHiddenRanges: false,
});
const models = characters.map((character) => {
  const model = assets[character + "-0"];
  if (model.inputs.skin.sha256 !== skins.get(character))
    throw Error(`Authored ${character} skin changed during export`);
  return { modelId: character, ...model };
});

await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify({
    schema: 1,
    build,
    protocol,
    replaySha256,
    decoderSha256,
    creationTableSha256,
    archive,
    installedExeSha256,
    toolchain,
    models,
    actors,
  }),
  { flag: "wx" },
);
