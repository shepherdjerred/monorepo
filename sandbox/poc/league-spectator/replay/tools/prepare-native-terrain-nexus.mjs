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
import { createPosition944ReaderFromCodecs } from "./research/native-terrain-positions-944-reader.mjs";
import { createExactTerrainByteCodecs } from "./research/native-terrain-positions-944.mjs";
import {
  currentMap11WadIndexSha256,
  prepareNativeTerrainTurrets,
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
  [
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
    [1073742159, 1073742155],
  ],
]);
const nexusPlacements = [
  { mapNameHash: 1341187095, skinId: 0 },
  { mapNameHash: 712301631, skinId: 3 },
];
const field = (node, name) => node?.fields?.[mapBinHash(name)];
const rotateByte = (byte, shift) =>
  ((byte << shift) | (byte >>> (8 - shift))) & 0xff;

function readNexusDeathCue(payload, decodeSyncByte) {
  // Factory 0x10198e6 and reader 0x1032910 select string reader 0x10a9760
  // for this three-byte header. The reader copies decoded text in reverse.
  if (
    payload.length !== 14 ||
    payload[0] !== 0xbe ||
    payload[1] !== 0xbf ||
    payload[2] !== 0xeb
  )
    throw Error("Unexpected reviewed Nexus animation packet header");
  // Recover the common 256-byte table by inverting the admitted sync-byte
  // transform. The exact build uses the same table at 0x21485c0 and 0x2148f00.
  const substitute = (byte) =>
    rotateByte((decodeSyncByte((byte - 0x64) & 0xff) - 0xed) & 0xff, 2) ^ 0xff;
  const decoded = Uint8Array.from(payload.subarray(3), (byte) => {
    const lookup = substitute((rotateByte(substitute(byte), 4) + 0xc7) & 0xff);
    const swapped = ((lookup >>> 1) & 0x55) | ((lookup << 1) & 0xaa);
    return (swapped + 0xcf) & 0xff;
  });
  if (decoded[0] !== decoded.length - 1)
    throw Error("Unexpected Nexus animation name length");
  const name = new TextDecoder("utf-8", { fatal: true }).decode(
    decoded.subarray(1).reverse(),
  );
  if (name !== "NexusDeath")
    throw Error("Unexpected reviewed Nexus animation name");
  return name;
}

const [
  installation,
  replayFile,
  archivedMapFile,
  decoderFile,
  exporter,
  outArg,
  placementFile,
  ...extra
] = process.argv.slice(2);
if (!outArg || extra.length)
  throw Error(
    "Usage: bun prepare-native-terrain-nexus.mjs <installation> <saved ROFL> <archived materials.bin> <exact decoder> <ordinal exporter bin dir> <new .cache subdirectory> [current turret placement receipt]",
  );

const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Nexus output must stay in private .cache");
const destination = join(parent, basename(output));

const bytes = (path) => Bun.file(path).bytes();
const replay = Uint8Array.from(await bytes(replayFile));
const replaySha256 = sha(replay);
const contexts = reviewedReplays.get(replaySha256);
if (!contexts) throw Error("Expected a reviewed exact-build replay");
const options = { allowCurrentBuild: true };
const prepared = prepareReplayForSeek(
  replay.buffer,
  (input, target) =>
    zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
  options,
);
const { packetReader, observations } = prepared;
const { build } = packetReader;
const current = build === currentTerrainPositionBuild;
const installedExeSha256 = championArchiveExecutableHashes[build];
if (installedExeSha256 === undefined || packetReader.protocol !== protocol)
  throw Error("Unexpected Nexus replay build or protocol");
const decoder = await bytes(decoderFile);
const codecs = createExactTerrainByteCodecs(decoder, packetReader, options);
const readPosition = createPosition944ReaderFromCodecs(codecs);

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
let placementReceiptSha256;
if (current) {
  if (!placementFile)
    throw Error("Current Nexus requires the reviewed turret placements");
  const placementBytes = await bytes(placementFile);
  placementReceiptSha256 = sha(placementBytes);
  if (placementReceiptSha256 !== turretPlacementReceiptDigests[build])
    throw Error("Current Nexus placement receipt differs from its pin");
  const { opening } = prepareNativeTerrainTurrets(
    prepared,
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(placementBytes),
    ),
    options,
  );
  const rows = inventory.registration.filter(
    ({ kind, attackableType }) =>
      kind === "barracks" || [0, 1, 2].includes(attackableType),
  );
  const turretAnchors = new Map(opening.map((row) => [row.mapNameHash, row]));
  const firstContext = turretAnchors.get(rows[0]?.mapNameHash)?.context;
  if (!firstContext || rows.length !== 38)
    throw Error("Unexpected current Nexus registration cohort");
  const verifiedNexuses = new Map();
  for (const [index, row] of rows.entries()) {
    const context = firstContext + index;
    if (row.attackableType === 0) {
      const anchor = turretAnchors.get(row.mapNameHash);
      if (
        anchor?.context !== context ||
        anchor.worldPosition.some(
          (coordinate, axis) => coordinate !== row.transform[3][axis],
        )
      )
        throw Error(
          "Nexus registration disagrees with a recorded turret anchor",
        );
      turretAnchors.delete(row.mapNameHash);
    }
    if (row.attackableType === 2) verifiedNexuses.set(row.mapNameHash, context);
  }
  if (
    turretAnchors.size !== 0 ||
    verifiedNexuses.size !== nexusPlacements.length ||
    nexusPlacements.some(
      ({ mapNameHash }, index) =>
        verifiedNexuses.get(mapNameHash) !== contexts[index],
    )
  )
    throw Error("Nexus registration differs from the reviewed contexts");
} else if (placementFile !== undefined) {
  throw Error(
    "A turret placement receipt is only used by current Nexus extraction",
  );
}
const instances = nexusPlacements.map(({ mapNameHash, skinId }, index) => {
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
    context: contexts[index],
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
    observedKeyframeSeconds: [],
    terminalState: "unverified",
  };
});
const byContext = new Map(
  instances.map((instance) => [instance.context, instance]),
);
const terminalPackets = [];
const terminalLoss = current
  ? observations.structures?.find(
      ({ kind }) => kind === "match-ending-structure-loss",
    )
  : undefined;
const terminalEvidence = [];
if (current && (!terminalLoss || !byContext.has(terminalLoss.context)))
  throw Error("Expected a corroborated terminal Nexus loss");
const frames = packetReader.keyframes;
for (const [index, frame] of frames.entries()) {
  // A seek immediately before the next keyframe reads this snapshot and all
  // its preceding deltas. The footer bounds the final window.
  const cutoff =
    index + 1 === frames.length
      ? packetReader.durationSeconds
      : frames[index + 1].timeSeconds - 0.000001;
  const seenPosition = new Set();
  const seenSnapshot = new Set();
  let opcode;
  let context = 0;
  for (const packet of packetReader.read(cutoff).packets) {
    if (packet.blockOffset === 0) {
      opcode = undefined;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    const instance = byContext.get(context);
    if (!instance) continue;
    if (packet.stream === 2 && packet.chunkOffset === frame.chunkOffset) {
      if (opcode === 944) {
        const position = readPosition(packet.payload);
        if (
          !position ||
          position.x !== instance.transform[12] ||
          position.z !== instance.transform[14] ||
          seenPosition.has(context)
        )
          throw Error(
            "Recorded Nexus position differs from authored placement",
          );
        seenPosition.add(context);
      }
      // This is the 63-byte Nexus cohort, distinct from the 41-byte turret
      // state whose lifecycle bits have been verified.
      const nexusSnapshot = current
        ? Buffer.from(packet.payload).toString("hex") === "be71a6"
        : packet.payload.length === 63;
      if (opcode === 1012 && nexusSnapshot) {
        if (seenSnapshot.has(context))
          throw Error("Duplicate Nexus snapshot packet");
        seenSnapshot.add(context);
      }
    }
    if (packet.stream === 1 && opcode === 669) {
      terminalPackets.push({
        context,
        opcode,
        timeSeconds: packet.timeSeconds,
        payloadSha256: sha(packet.payload),
        animationName: readNexusDeathCue(packet.payload, codecs.decodeSyncByte),
      });
    }
    if (
      terminalLoss &&
      packet.stream === 1 &&
      opcode === 172 &&
      packet.payload.length === 116 &&
      context === terminalLoss.context &&
      packet.secondTimeBits === terminalLoss.secondTimeBits &&
      packet.timeSeconds === terminalLoss.timeSeconds
    )
      terminalEvidence.push({
        ...terminalLoss,
        opcode,
        payloadSha256: sha(packet.payload),
      });
  }
  for (const instance of instances) {
    if (
      (!current && !seenPosition.has(instance.context)) ||
      !seenSnapshot.has(instance.context)
    )
      throw Error("Recorded Nexus position or independent snapshot is absent");
    instance.observedKeyframeSeconds.push(frame.timeSeconds);
  }
}
if (current) {
  if (
    terminalEvidence.length !== 1 ||
    terminalPackets.length !== 0 ||
    terminalEvidence[0].timeSeconds <= frames.at(-1).timeSeconds
  )
    throw Error("Unexpected current Nexus terminal evidence");
} else if (
  terminalPackets.length !== 1 ||
  terminalPackets[0].timeSeconds <= frames.at(-1).timeSeconds
)
  throw Error("Unexpected reviewed Nexus terminal packet cohort");

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
const manifest = {
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
  instances,
  terminalPackets,
  ...(current
    ? {
        terminalEvidence: terminalEvidence[0],
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
    instances: instances.length,
    keyframes: frames.length,
    terminalPackets,
  }),
);
