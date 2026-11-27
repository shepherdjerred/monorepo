// Export exact-build inhibitor skins and bind the authored registration to a saved replay.
import { realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { readMap11PlaceableInventory } from "./map11-world-catalog.mjs";
import { exportNativeTerrainStructureModels } from "./native-terrain-structure-model-export.mjs";
import { bindNativeTerrainInhibitorCatalog } from "./research/native-terrain-inhibitor-catalog.mjs";
import { championArchiveExecutableHashes } from "./research/native-terrain-champion-model-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./research/native-terrain-byte-codecs.mjs";
import {
  currentMap11WadIndexSha256,
  turretPlacementReceiptDigests,
} from "./research/native-terrain-turrets.mjs";
import {
  readKeyedPlaceableSpan,
  uniqueInstalledOffset,
} from "./verify-installed-map11-placements.mjs";
import { openLocalWad } from "./wad.mjs";

const [
  installation,
  replayOrBuild,
  receiptFile,
  archivedMaterials,
  exporter,
  outArg,
  profile,
  ...extra
] = process.argv.slice(2);
const authored = profile === "--authored-catalog";
if (
  !outArg ||
  extra.length ||
  (profile !== undefined && !authored) ||
  (authored && replayOrBuild !== currentTerrainPositionBuild)
)
  throw Error(
    "Usage: bun prepare-native-terrain-inhibitors.mjs <installation> <saved ROFL | 16.23.841.8428> <turret placement receipt> <archived materials.bin> <ordinal exporter bin dir> <new .cache subdirectory> [--authored-catalog]",
  );

const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Inhibitor output must stay in private .cache");
const destination = join(parent, basename(output));
const bytes = (path) => Bun.file(path).bytes();
const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const replay = authored
  ? undefined
  : Uint8Array.from(await bytes(replayOrBuild));
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
const { build, protocol } = prepared?.packetReader ?? {
  build: currentTerrainPositionBuild,
  protocol: terrainPositionProtocol,
};
const current = build === currentTerrainPositionBuild;
const receiptBytes = await bytes(receiptFile);
const placementReceiptSha256 = sha(receiptBytes);
if (placementReceiptSha256 !== turretPlacementReceiptDigests[build])
  throw Error("Unexpected exact Map11 turret placement receipt");
const receipt = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes),
);
const executable = join(installation, "Game", "League of Legends.exe");
const installedExeSha256 = sha(await bytes(executable));
if (installedExeSha256 !== championArchiveExecutableHashes[build])
  throw Error("Installed game executable differs from reviewed build");
const wad = await openLocalWad(
  installation,
  archive,
  Bun.zstdDecompressSync,
  current ? currentMap11WadIndexSha256 : undefined,
);
const [archived, installedBytes] = await Promise.all([
  bytes(archivedMaterials),
  wad(receipt.entryPath),
]);
const installed = Buffer.from(installedBytes);
if (
  sha(archived) !== receipt.archivedSha256 ||
  sha(installed) !== receipt.installedSha256
)
  throw Error("Unexpected Map11 registration source");
const tree = readExactMapBin(archived, receipt.archivedBuild, {
  captureFieldSpans: true,
});
const inventory = readMap11PlaceableInventory(tree, "09e8f830");
const chunks = new Map(tree.objects.map((object) => [object.pathHash, object]));
const rows = inventory.registration.filter(
  ({ kind, attackableType }) =>
    kind === "barracks" || [0, 1, 2].includes(attackableType),
);
if (rows.length !== 38)
  throw Error("Unexpected exact Map11 registration cohort");
const installedSpans = new Set();
const registration = rows.map((row) => {
  const chunk = chunks.get(row.sourceChunk.slice(1, -1));
  const entry = chunk?.fields[mapBinHash("items")]?.entries.find(
    ({ key }) => key.value === row.keyHash,
  );
  const span = readKeyedPlaceableSpan(archived, row.keyHash, entry?.value);
  const installedOffset = uniqueInstalledOffset(installed, span.bytes);
  if (installedSpans.has(installedOffset))
    throw Error("Repeated exact registration span");
  installedSpans.add(installedOffset);
  const {
    kind,
    attackableType,
    mapNameHash,
    characterRecord,
    asset,
    explicitTeam,
    transform,
  } = row;
  return {
    kind,
    attackableType,
    mapNameHash,
    characterRecord,
    asset,
    explicitTeam,
    transform,
    placementSource: {
      archivedOffset: span.offset,
      installedOffset,
      bytes: span.bytes.length,
      sha256: sha(span.bytes),
    },
  };
});
const catalog = {
  schema: 1,
  kind: "exact-native-terrain-inhibitor-catalog",
  build,
  protocol,
  placementReceiptSha256,
  installedExeSha256,
  installedMapSha256: receipt.installedSha256,
  registration,
};
const bound =
  prepared === undefined
    ? undefined
    : bindNativeTerrainInhibitorCatalog(prepared, receipt, catalog, options);
const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  character: "Inhibitor",
  destination,
  exporter,
  wad,
  requireHiddenRanges: false,
});
const manifest =
  bound === undefined || replay === undefined
    ? { ...catalog, assets, toolchain }
    : {
        schema: 1,
        kind: "exact-native-terrain-inhibitors",
        build,
        protocol,
        replaySha256: sha(replay),
        placementReceiptSha256,
        installedExeSha256,
        installedMapSha256: receipt.installedSha256,
        scope:
          "Authored opening inhibitor models and verified loss clocks. Destroyed meshes, transition animation and respawn presentation are unverified.",
        assets,
        toolchain,
        turretAnchors: bound.turretAnchors,
        instances: bound.instances,
        losses: bound.losses,
        ...(current
          ? {
              presentationOmissions: bound.presentationOmissions,
              unresolvedSnapshotStates: bound.unresolvedSnapshotStates,
            }
          : {}),
      };
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    destination,
    ...(bound === undefined
      ? { registration: catalog.registration.length }
      : { instances: bound.instances.length, losses: bound.losses }),
  }),
);
