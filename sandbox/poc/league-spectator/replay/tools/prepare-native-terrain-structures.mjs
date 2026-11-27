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
import { currentTerrainPositionBuild } from "./research/native-terrain-byte-codecs.mjs";
import {
  currentMap11WadIndexSha256,
  prepareNativeTerrainTurrets,
  turretPlacementReceiptDigests,
} from "./research/native-terrain-turrets.mjs";
import { readKeyedPlaceableSpan } from "./verify-installed-map11-placements.mjs";
import { openLocalWad } from "./wad.mjs";

const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
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
    "Usage: bun prepare-native-terrain-structures.mjs <installation> <saved ROFL> <placement receipt> <archived materials.bin> <ordinal exporter bin dir> <new .cache subdirectory>",
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
const replay = Uint8Array.from(await bytes(replayFile));
const options = { allowCurrentBuild: true };
const prepared = prepareReplayForSeek(
  replay.buffer,
  (input, target) =>
    zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
  options,
);
const { build, protocol } = prepared.packetReader;
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

const {
  opening,
  renderableLosses: losses,
  presentationOmissions,
} = prepareNativeTerrainTurrets(prepared, receipt, options);
const disputedContexts = new Set(
  presentationOmissions.map(({ context }) => context),
);
const lossTimes = new Map(
  losses.map(({ context, timeSeconds }) => [context, timeSeconds]),
);
const instances = [];
const omitted = [];
for (const { context, mapNameHash } of opening) {
  const { asset, transform, characterRecord } =
    inventory.placeables[mapNameHash];
  if (disputedContexts.has(context)) continue;
  if (asset !== "turret/0" && asset !== "turret/3") {
    omitted.push({
      context,
      mapNameHash,
      asset,
      reason: "Nonstandard structure without verified lifetime",
    });
    continue;
  }
  instances.push({
    context,
    mapNameHash,
    characterRecord,
    transform: transform.flat(),
    assetId: asset.replace("/", "-"),
    destroyedAtSeconds: lossTimes.get(context) ?? null,
  });
}
if (
  instances.length !== 22 - presentationOmissions.length ||
  instances.filter(({ destroyedAtSeconds }) => destroyedAtSeconds !== null)
    .length !== losses.length
)
  throw Error("Verified losses must belong to the 22 authored turret cohort");

const snapshots = new Map(
  instances.map(({ context }) => [context, { alive: 0, dead: 0, missing: 0 }]),
);
const reader = prepared.packetReader;
const lastFrame = reader.keyframes.at(-1);
for (const frame of reader.keyframes) {
  const { packets } = reader.read(frame.timeSeconds);
  const state = new Map();
  let context = 0;
  let opcode;
  for (const packet of packets) {
    if (packet.stream !== 2 || packet.chunkOffset !== frame.chunkOffset)
      continue;
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (
      opcode !== 1012 ||
      packet.payload.length !== 41 ||
      !snapshots.has(context)
    )
      continue;
    const observedDead = (packet.payload[13] & 8) === 0;
    if (state.has(context) && state.get(context) !== observedDead)
      throw Error("Conflicting recorded turret snapshot state");
    state.set(context, observedDead);
  }
  for (const { context, destroyedAtSeconds } of instances) {
    if (frame.timeSeconds === destroyedAtSeconds) continue;
    const dead = state.get(context);
    if (dead === undefined) {
      if (
        frame.timeSeconds === 0 ||
        (frame === lastFrame && destroyedAtSeconds === null)
      )
        throw Error("Required opening or surviving turret snapshot absent");
      snapshots.get(context).missing++;
      continue;
    }
    if (
      dead !==
      (destroyedAtSeconds !== null && frame.timeSeconds > destroyedAtSeconds)
    )
      throw Error("Recorded turret state disagrees with verified loss history");
    snapshots.get(context)[dead ? "dead" : "alive"]++;
  }
}

const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  character: "Turret",
  destination,
  exporter,
  wad,
});

const manifest = {
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
  instances,
  omitted,
  ...(current ? { presentationOmissions } : {}),
  snapshotEvidence: {
    lastSnapshotSeconds: lastFrame.timeSeconds,
    keyframes: reader.keyframes.length,
    counts: Object.fromEntries(snapshots),
  },
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
    losses: losses.length,
    omitted,
  }),
);
