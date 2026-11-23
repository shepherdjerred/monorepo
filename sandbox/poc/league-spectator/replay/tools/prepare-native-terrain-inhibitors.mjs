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
import { prepareNativeTerrainInhibitors } from "./research/native-terrain-inhibitors.mjs";
import { prepareNativeTerrainTurrets } from "./research/native-terrain-turrets.mjs";
import {
  readKeyedPlaceableSpan,
  uniqueInstalledOffset,
} from "./verify-installed-map11-placements.mjs";
import { openLocalWad } from "./wad.mjs";

const [
  installation,
  replayFile,
  receiptFile,
  archivedMaterials,
  exporter,
  outArg,
  ...extra
] = process.argv.slice(2);
if (!outArg || extra.length)
  throw Error(
    "Usage: bun prepare-native-terrain-inhibitors.mjs <installation> <saved ROFL> <turret placement receipt> <archived materials.bin> <ordinal exporter bin dir> <new .cache subdirectory>",
  );

const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Inhibitor output must stay in private .cache");
const destination = join(parent, basename(output));
const bytes = (path) => Bun.file(path).bytes();
const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const receiptBytes = await bytes(receiptFile);
const placementReceiptSha256 = sha(receiptBytes);
if (
  placementReceiptSha256 !==
  "e8b440a974777974ed09cfc799b0e21ed01ee6a809543e3fe04a639fca04ed40"
)
  throw Error("Unexpected exact Map11 turret placement receipt");
const receipt = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(receiptBytes),
);
const executable = join(installation, "Game", "League of Legends.exe");
const installedExeSha256 = sha(await bytes(executable));
if (
  installedExeSha256 !==
  "89d73a9e6d886c291f5b3cf42904e5e8b014148b56490d2b6c862ea96cc9f156"
)
  throw Error("Installed game executable differs from reviewed build");
const wad = await openLocalWad(installation, archive, Bun.zstdDecompressSync);
const [archived, installedBytes, replayBytes] = await Promise.all([
  bytes(archivedMaterials),
  wad(receipt.entryPath),
  bytes(replayFile),
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
const replay = Uint8Array.from(replayBytes);
const prepared = prepareReplayForSeek(replay.buffer, (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
);
const { packetReader } = prepared;
const { opening } = prepareNativeTerrainTurrets(prepared, receipt);
const inhibitors = prepareNativeTerrainInhibitors(prepared);
const openingInhibitors = new Set(
  inhibitors.read(0).inhibitors.map(({ context }) => context),
);
const turretByName = new Map(opening.map((row) => [row.mapNameHash, row]));

// The ordered Map11 cohort allocates contexts to attackable structures and
// barracks. Every independently decoded turret name and position must align.
// The six remaining inhibitor slots must exactly match opcode 947 snapshots.
const rows = inventory.registration.filter(
  ({ kind, attackableType }) =>
    kind === "barracks" || [0, 1, 2].includes(attackableType),
);
const firstContext = turretByName.get(rows[0]?.mapNameHash)?.context;
if (!firstContext || rows.length !== 38)
  throw Error("Unexpected exact Map11 registration cohort");
const installedSpans = new Set();
const instances = [];
const turretAnchors = [];
for (const [index, row] of rows.entries()) {
  const context = firstContext + index;
  const chunk = chunks.get(row.sourceChunk.slice(1, -1));
  const entry = chunk?.fields[mapBinHash("items")]?.entries.find(
    ({ key }) => key.value === row.keyHash,
  );
  const span = readKeyedPlaceableSpan(archived, row.keyHash, entry?.value);
  const installedOffset = uniqueInstalledOffset(installed, span.bytes);
  if (installedSpans.has(installedOffset))
    throw Error("Repeated exact registration span");
  installedSpans.add(installedOffset);
  if (row.attackableType === 0) {
    const anchor = turretByName.get(row.mapNameHash);
    if (
      anchor?.context !== context ||
      anchor.worldPosition.some(
        (coordinate, axis) => coordinate !== row.transform[3][axis],
      )
    )
      throw Error(
        "Replay turret anchors disagree with authored registration order",
      );
    turretAnchors.push(anchor);
  }
  if (row.attackableType !== 1) continue;
  if (!openingInhibitors.delete(context))
    throw Error("Inhibitor slot lacks independent recorded opening state");
  const team =
    row.characterRecord === "Characters/Inhibitor/CharacterRecords/SR_Order" &&
    row.asset === "inhibitor/0" &&
    row.explicitTeam === null
      ? 100
      : row.characterRecord ===
            "Characters/Inhibitor/CharacterRecords/SR_Chaos" &&
          row.asset === "inhibitor/3" &&
          row.explicitTeam === 200
        ? 200
        : undefined;
  if (team === undefined)
    throw Error("Unexpected authored inhibitor appearance");
  instances.push({
    context,
    mapNameHash: row.mapNameHash,
    assetId: row.asset.replace("/", "-"),
    team,
    transform: row.transform.flat(),
    placementSource: {
      archivedOffset: span.offset,
      installedOffset,
      bytes: span.bytes.length,
      sha256: sha(span.bytes),
    },
  });
}
if (
  turretAnchors.length !== 24 ||
  openingInhibitors.size ||
  instances.length !== 6 ||
  instances.filter(({ team }) => team === 100).length !== 3 ||
  inhibitors.losses === null
)
  throw Error("Incomplete exact inhibitor placement or lifecycle evidence");
const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  character: "Inhibitor",
  destination,
  exporter,
  wad,
  requireHiddenRanges: false,
});
const manifest = {
  schema: 1,
  kind: "exact-native-terrain-inhibitors",
  build: packetReader.build,
  protocol: packetReader.protocol,
  replaySha256: sha(replay),
  placementReceiptSha256,
  installedExeSha256,
  installedMapSha256: receipt.installedSha256,
  scope:
    "Authored opening inhibitor models and verified loss clocks. Destroyed meshes, transition animation and respawn presentation are unverified.",
  assets,
  toolchain,
  turretAnchors,
  instances,
  losses: inhibitors.losses,
};
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    destination,
    instances: instances.length,
    losses: inhibitors.losses,
  }),
);
