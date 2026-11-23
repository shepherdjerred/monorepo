import { realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { openReplay } from "../transport.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { exportNativeTerrainStructureModels } from "./native-terrain-structure-model-export.mjs";
import { decodeRecordedNeutralObjectives } from "./research/recorded-neutral-objectives.mjs";
import { openLocalWad } from "./wad.mjs";

const [installation, replayFile, decoderFile, exporter, outArg, ...extra] =
  process.argv.slice(2);
if (!outArg || extra.length)
  throw Error(
    "Usage: bun prepare-native-terrain-neutral-objectives.mjs <archive root> <saved ROFL> <exact decoder> <ordinal exporter bin dir> <new .cache subdirectory>",
  );

const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Neutral objective output must stay in private .cache");
const destination = join(parent, basename(output));

const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const skins = new Map([
  [
    "sru_baron",
    "7fe7cc331edf7debbe5d3a103494bc4c6313fcd9c532ee6dff610729cc4edd28",
  ],
  [
    "sru_riftherald",
    "78e584be38f96e3b7b4e1c435d220a7722f2a961a0b8bb012dbe5e923618cf0e",
  ],
]);

const replay = openReplay(await Bun.file(replayFile).arrayBuffer());
const decoder = await Bun.file(decoderFile).bytes();
const proof = decodeRecordedNeutralObjectives(
  replay,
  decoder,
  (stored, output) =>
    zstdDecompressSync(stored, { maxOutputLength: output.length }),
);
if (!proof) throw Error("Expected the reviewed long objective replay");

const wad = await openLocalWad(installation, archive, Bun.zstdDecompressSync);
for (const [character, digest] of skins) {
  if (
    sha(await wad("data/characters/" + character + "/skins/skin0.bin")) !==
    digest
  )
    throw Error("Unexpected authored objective skin " + character);
}
const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  destination,
  exporter,
  wad,
  skins: [...skins.keys()].map((character) => ({ character, skinId: 0 })),
  requireHiddenRanges: false,
});
const models = [...skins].map(([modelId, digest]) => {
  const asset = assets[modelId + "-0"];
  if (asset.inputs.skin.sha256 !== digest)
    throw Error("Authored objective skin changed during export");
  return { modelId, ...asset };
});

await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify({
    schema: 1,
    build: replay.build,
    protocol: replay.protocol,
    replaySha256: sha(replay.bytes),
    decoderSha256: sha(decoder),
    archive,
    toolchain,
    models,
    ...proof,
  }),
  { flag: "wx" },
);
