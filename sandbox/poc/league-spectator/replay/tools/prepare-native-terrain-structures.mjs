// Private exact-build authored turrets. Run only against local saved inputs.
import { realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { readMap11PlaceableInventory } from "./map11-world-catalog.mjs";
import { exportNativeTerrainStructureModels } from "./native-terrain-structure-model-export.mjs";
import { championArchiveExecutableHashes } from "./research/native-terrain-champion-model-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./research/native-terrain-byte-codecs.mjs";
import { bindNativeTerrainTurretCatalog } from "./research/native-terrain-turret-catalog.mjs";
import {
  currentMap11WadIndexSha256,
  turretPlacementReceiptDigests,
} from "./research/native-terrain-turrets.mjs";
import { readKeyedPlaceableSpan } from "./verify-installed-map11-placements.mjs";
import { openLocalWad } from "./wad.mjs";

const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
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
    "Usage: bun prepare-native-terrain-structures.mjs <installation> <saved ROFL | 16.23.841.8428> <placement receipt> <archived materials.bin> <ordinal exporter bin dir> <new .cache subdirectory> [--authored-catalog]",
  );

const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Structure output must stay in private .cache");
const destination = join(parent, relative(dirname(output), output));
const bytes = (path) => Bun.file(path).bytes();
const json = (data) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
const blob = (file, data) => ({ file, bytes: data.length, sha256: sha(data) });
const field = (node, name) => node?.fields?.[mapBinHash(name)];
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
const placementReceiptSha256 = turretPlacementReceiptDigests[build];
const installedExeSha256 = championArchiveExecutableHashes[build];
const receiptBytes = await bytes(receiptFile);
if (sha(receiptBytes) !== placementReceiptSha256)
  throw Error("Unexpected reviewed Map11 placement receipt digest");
const receipt = json(receiptBytes);
const old = await bytes(archivedMaterials);
if (sha(old) !== receipt.archivedSha256)
  throw Error("Archived map bytes differ from placement receipt");
const executable = join(installation, "Game", "League of Legends.exe");
if (sha(await bytes(executable)) !== installedExeSha256)
  throw Error("Installed game executable differs from reviewed build");
const wad = await openLocalWad(
  installation,
  archive,
  Bun.zstdDecompressSync,
  current ? currentMap11WadIndexSha256 : undefined,
);
const installed = await wad(receipt.entryPath);
if (sha(installed) !== receipt.installedSha256)
  throw Error("Installed Map11 bytes differ from placement receipt");

const tree = readExactMapBin(old, receipt.archivedBuild, {
  captureFieldSpans: true,
});
const containers = tree.objects.filter(
  ({ classHash }) => classHash === mapBinHash("MapContainer"),
);
if (containers.length !== 1)
  throw Error("Expected one archived Map11 container");
const inventory = readMap11PlaceableInventory(tree, containers[0].pathHash);
const chunks = new Map(tree.objects.map((object) => [object.pathHash, object]));
for (const record of receipt.records) {
  const placement = inventory.placeables[record.mapNameHash];
  const chunk = chunks.get(placement?.sourceChunk.slice(1, -1));
  const entry = field(chunk, "items")?.entries.find(
    ({ key }) => key.value === record.keyHash,
  );
  const original = readKeyedPlaceableSpan(old, record.keyHash, entry?.value);
  if (
    placement.attackableType !== 0 ||
    placement.keyHash !== record.keyHash ||
    original.offset !== record.archivedOffset ||
    original.bytes.length !== record.bytes ||
    sha(original.bytes) !== record.sha256 ||
    sha(
      installed.subarray(
        record.installedOffset,
        record.installedOffset + record.bytes,
      ),
    ) !== record.sha256 ||
    placement.transform[3]
      .slice(0, 3)
      .some((coordinate, axis) => coordinate !== record.translation[axis])
  )
    throw Error(
      "Authored structure selection, placement, or source bytes differ from the receipt",
    );
}

const catalog = {
  schema: 1,
  kind: "exact-native-terrain-turret-catalog",
  build,
  protocol,
  placementReceiptSha256,
  installedExeSha256,
  installedMaterials: { archive, ...blob(receipt.entryPath, installed) },
  placeables: receipt.records.map(({ mapNameHash }) => {
    const { asset, transform, characterRecord } =
      inventory.placeables[mapNameHash];
    return { mapNameHash, asset, transform, characterRecord };
  }),
};
const bound =
  prepared === undefined
    ? undefined
    : bindNativeTerrainTurretCatalog(prepared, receipt, catalog, options);

const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  character: "Turret",
  destination,
  exporter,
  wad,
});

const manifest =
  bound === undefined || replay === undefined
    ? { ...catalog, toolchain, assets }
    : {
        schema: 1,
        kind: "exact-native-terrain-structures",
        build,
        protocol,
        replaySha256: sha(replay),
        placementReceiptSha256,
        installedExeSha256,
        installedMaterials: { archive, ...blob(receipt.entryPath, installed) },
        toolchain,
        scope:
          "Authored opening turret poses; indexed snapshots and verified loss times. Damaged stages, ruined turrets, inhibitors, and nexus presentation are unresolved.",
        assets,
        instances: bound.instances,
        omitted: bound.omitted,
        ...(current
          ? { presentationOmissions: bound.presentationOmissions }
          : {}),
        snapshotEvidence: bound.snapshotEvidence,
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
      ? { placeables: catalog.placeables.length }
      : {
          instances: bound.instances.length,
          losses: bound.losses.length,
          omitted: bound.omitted,
        }),
  }),
);
