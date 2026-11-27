// Private exact-build Nexus model and replay snapshot evidence.
import { realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { archivedAnimationFormat } from "./archived-animation-format.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { readMap11PlaceableInventory } from "./map11-world-catalog.mjs";
import { exportNativeTerrainStructureModels } from "./native-terrain-structure-model-export.mjs";
import { championArchiveExecutableHashes } from "./research/native-terrain-champion-model-catalog.mjs";
import { currentTerrainPositionBuild } from "./research/native-terrain-byte-codecs.mjs";
import {
  bindNativeTerrainNexusCatalog,
  corroborateNativeTerrainNexus,
  nexusPlacements,
} from "./research/native-terrain-nexus-catalog.mjs";
import { createExactTerrainByteCodecs } from "./research/native-terrain-positions-944.mjs";
import {
  currentMap11WadIndexSha256,
  turretPlacementReceiptDigests,
} from "./research/native-terrain-turrets.mjs";
import {
  readKeyedPlaceableSpan,
  uniqueInstalledOffset,
} from "./verify-installed-map11-placements.mjs";
import { openLocalWad } from "./wad.mjs";

const protocol = "8bbfcd5af2bc92db";
const archivedMapSha256 =
  "b8709c64290fe8327ee1d14e927628efddd6dcea9ef1968989098d8477e71c3c";
const installedMapSha256 =
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a";
const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const entryPath = "data/maps/mapgeometry/map11/base_srx.materials.bin";
const reviewedReplays = new Map([
  [
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
    [1073742416, 1073742417],
  ],
  [
    "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
    [1073742412, 1073742413],
  ],
]);
const field = (node, name) => node?.fields?.[mapBinHash(name)];

const [
  installation,
  replayOrBuild,
  archivedMapFile,
  decoderFile,
  exporter,
  outArg,
  placementFile,
  profile,
  ...extra
] = process.argv.slice(2);
const authored = profile === "--authored-catalog";
if (
  !outArg ||
  extra.length ||
  (profile !== undefined && !authored) ||
  (authored &&
    (replayOrBuild !== currentTerrainPositionBuild || decoderFile !== "-"))
)
  throw Error(
    "Usage: bun prepare-native-terrain-nexus.mjs <installation> <saved ROFL | 16.23.841.8428> <archived materials.bin> <exact decoder | -> <ordinal exporter bin dir> <new .cache subdirectory> [current turret placement receipt [--authored-catalog]]",
  );

const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Nexus output must stay in private .cache");
const destination = join(parent, basename(output));

const bytes = (path) => Bun.file(path).bytes();
const replay = authored
  ? undefined
  : Uint8Array.from(await bytes(replayOrBuild));
const replaySha256 = replay === undefined ? undefined : sha(replay);
const options = { allowCurrentBuild: true };
const prepared =
  replay === undefined
    ? undefined
    : prepareReplayForSeek(
        replay.buffer,
        (input, target) =>
          zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
        options,
      );
const packetReader = prepared?.packetReader;
const build = packetReader?.build ?? currentTerrainPositionBuild;
const current = build === currentTerrainPositionBuild;
const contexts = reviewedReplays.get(replaySha256);
const installedExeSha256 = championArchiveExecutableHashes[build];
if (
  installedExeSha256 === undefined ||
  (packetReader !== undefined && packetReader.protocol !== protocol) ||
  (!current && contexts === undefined)
)
  throw Error("Unexpected Nexus replay build, protocol, or archived fixture");
const decoder = authored ? undefined : await bytes(decoderFile);
const codecs =
  decoder === undefined
    ? undefined
    : createExactTerrainByteCodecs(decoder, packetReader, options);

const executable = join(installation, "Game", "League of Legends.exe");
if (sha(await bytes(executable)) !== installedExeSha256)
  throw Error("Installed game executable differs from reviewed build");
const wad = await openLocalWad(
  installation,
  archive,
  Bun.zstdDecompressSync,
  current ? currentMap11WadIndexSha256 : undefined,
);
const [archived, installedBytes] = await Promise.all([
  bytes(archivedMapFile),
  wad(entryPath),
]);
const installed = Buffer.from(installedBytes);
if (
  sha(archived) !== archivedMapSha256 ||
  sha(installed) !== installedMapSha256
)
  throw Error("Unexpected Map11 placement source");
const tree = readExactMapBin(archived, "16.21.829.8620", {
  captureFieldSpans: true,
});
const inventory = readMap11PlaceableInventory(tree, "09e8f830");
const chunks = new Map(tree.objects.map((object) => [object.pathHash, object]));
let receipt;
let placementReceiptSha256;
let registration;
if (current) {
  if (!placementFile)
    throw Error("Current Nexus requires the reviewed turret placements");
  const placementBytes = await bytes(placementFile);
  placementReceiptSha256 = sha(placementBytes);
  if (placementReceiptSha256 !== turretPlacementReceiptDigests[build])
    throw Error("Current Nexus placement receipt differs from its pin");
  receipt = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(placementBytes),
  );
  const offsets = new Set();
  registration = inventory.registration
    .filter(
      ({ kind, attackableType }) =>
        kind === "barracks" || [0, 1, 2].includes(attackableType),
    )
    .map((row) => {
      const chunk = chunks.get(row.sourceChunk.slice(1, -1));
      const entry = field(chunk, "items")?.entries.find(
        ({ key }) => key.value === row.keyHash,
      );
      const span = readKeyedPlaceableSpan(archived, row.keyHash, entry?.value);
      const offset = uniqueInstalledOffset(installed, span.bytes);
      if (offsets.has(offset))
        throw Error("Repeated exact Nexus registration span");
      offsets.add(offset);
      return {
        mapNameHash: row.mapNameHash,
        attackableType: row.attackableType,
        kind: row.kind,
        worldPosition: row.transform[3].slice(0, 3),
      };
    });
  if (registration.length !== 38)
    throw Error("Unexpected current Nexus registration cohort");
} else if (placementFile !== undefined) {
  throw Error(
    "A turret placement receipt is only used by current Nexus extraction",
  );
}
const placeables = nexusPlacements.map(({ mapNameHash, skinId }) => {
  const placement = inventory.placeables[mapNameHash];
  if (placement?.attackableType !== 2 || placement.asset !== `nexus/${skinId}`)
    throw Error("Unexpected authored Nexus placement or skin");
  const chunk = chunks.get(placement.sourceChunk.slice(1, -1));
  const entry = chunk?.fields[mapBinHash("items")]?.entries.find(
    ({ key }) => key.value === placement.keyHash,
  );
  const span = readKeyedPlaceableSpan(
    archived,
    placement.keyHash,
    entry?.value,
  );
  return {
    mapNameHash,
    assetId: `nexus-${skinId}`,
    characterRecord: placement.characterRecord,
    transform: placement.transform.flat(),
    placementSource: {
      archivedOffset: span.offset,
      installedOffset: uniqueInstalledOffset(installed, span.bytes),
      bytes: span.bytes.length,
      sha256: sha(span.bytes),
    },
  };
});
const catalog = {
  schema: 1,
  kind: "exact-native-terrain-nexus-catalog",
  build,
  protocol,
  installedExeSha256,
  map: { archive, entryPath, archivedMapSha256, installedMapSha256 },
  placementReceiptSha256,
  registration,
  placeables,
};
function bindArchived() {
  const instances = placeables.map((row, index) => ({
    context: contexts[index],
    ...row,
    observedKeyframeSeconds: [],
    terminalState: "unverified",
  }));
  return {
    instances,
    ...corroborateNativeTerrainNexus(prepared, instances, codecs),
  };
}
const bound = authored
  ? undefined
  : current
    ? bindNativeTerrainNexusCatalog(prepared, receipt, catalog, codecs, options)
    : bindArchived();
const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  character: "Nexus",
  destination,
  exporter,
  wad,
});
for (const asset of Object.values(assets)) {
  const skinBytes = await wad(asset.inputs.skin.file);
  if (sha(skinBytes) !== asset.inputs.skin.sha256)
    throw Error("Nexus skin changed during preparation");
  const skin = readExactMapBin(skinBytes);
  const skinRoot = skin.objects.find(
    ({ pathHash }) => pathHash === mapBinHash(asset.rootPath),
  );
  const graphReference = field(
    field(skinRoot, "skinAnimationProperties"),
    "animationGraphData",
  );
  const graphPath = `DATA/Characters/Nexus/Animations/Skin${asset.skinId}.bin`;
  if (
    graphReference?.type !== "ObjectLink" ||
    !skin.dependencies.includes(graphPath)
  )
    throw Error("Missing authored Nexus animation graph link");
  const graphData = await wad(graphPath);
  const graph = readExactMapBin(graphData).objects.find(
    ({ pathHash, classHash }) =>
      parseInt(pathHash, 16) === graphReference.value &&
      classHash === mapBinHash("animationGraphData"),
  );
  const clips = field(graph, "mClipDataMap")?.entries;
  const death = clips?.find(
    ({ key }) => key.value === parseInt(mapBinHash("Death"), 16),
  );
  const clipReference = field(
    field(death?.value, "mAnimationResourceData"),
    "mAnimationFilePath",
  );
  if (
    clipReference?.type !== "WadChunkLink" ||
    clips.some(
      ({ key }) => key.value === parseInt(mapBinHash("NexusDeath"), 16),
    )
  )
    throw Error("Unexpected Nexus Death clip or direct NexusDeath binding");
  const clipData = await wad.byHash(BigInt(clipReference.value));
  const format = archivedAnimationFormat(clipData);
  const clipFile = `work/nexus-${asset.skinId}/death.anm`;
  await writeFile(join(destination, clipFile), clipData, { flag: "wx" });
  asset.authoredDeath = {
    clipName: "Death",
    packetBinding: "unverified",
    graph: {
      archive,
      file: graphPath,
      bytes: graphData.length,
      sha256: sha(graphData),
    },
    clip: {
      archive,
      file: clipFile,
      reference: clipReference,
      bytes: clipData.length,
      sha256: sha(clipData),
      ...format,
    },
  };
}
const manifest =
  bound === undefined
    ? { ...catalog, toolchain, assets }
    : {
        schema: 1,
        kind: "exact-native-terrain-nexus",
        build,
        protocol,
        replaySha256,
        installedExeSha256,
        map: { archive, entryPath, archivedMapSha256, installedMapSha256 },
        decoderSha256: sha(decoder),
        toolchain,
        scope: current
          ? "Authored opening models bound by registered turret and Nexus contexts; indexed Nexus snapshots have no position payload. Terminal mesh and animation are unresolved."
          : "Authored opening models at recorded Nexus keyframes and a recorded NexusDeath cue. Continuous lifetime, terminal mesh state, and NexusDeath cue binding to the Death clip are unverified.",
        assets,
        instances: bound.instances,
        terminalPackets: bound.terminalPackets,
        ...(current
          ? {
              terminalEvidence: bound.terminalEvidence,
              placementReceiptSha256,
              positionEvidence: "authored-registration",
            }
          : {}),
      };
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  {
    flag: "wx",
  },
);
console.log(
  JSON.stringify({
    destination,
    ...(bound === undefined
      ? { placeables: placeables.length }
      : {
          instances: bound.instances.length,
          keyframes: packetReader.keyframes.length,
          terminalPackets: bound.terminalPackets,
        }),
  }),
);
