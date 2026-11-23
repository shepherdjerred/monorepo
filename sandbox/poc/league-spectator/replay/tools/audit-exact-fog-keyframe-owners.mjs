import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { createPosition944Reader } from "./research/native-terrain-positions-944.mjs";
import { prepareNativeTerrainTurrets } from "./research/native-terrain-turrets.mjs";

const [
  replayPath,
  decoderPath,
  providerPath,
  placementsPath,
  scenePath,
  output,
] = process.argv.slice(2);
if (process.argv.length !== 8)
  throw Error(
    "Usage: bun audit-exact-fog-keyframe-owners.mjs <saved-rofl> <exact-macos-binary> <provider-receipt> <placements> <exact-scene> <new-output.json>",
  );

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replaySha =
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b";
const providerSha =
  "cb604f00a79883ac58cc9771e7daefab4fe7fb44f436bba862f1b177f45a27f5";
const keyframeChunk = 2;
const keyframeTime = 60.02986145019531;
const replayBytes = readFileSync(replayPath);
const replayBuffer = Uint8Array.from(replayBytes).buffer;
const replay = openReplay(replayBuffer);
assert.equal(sha(replayBytes), replaySha);
assert.equal(replay.build, "16.23.840.6595");
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
const providerBytes = readFileSync(providerPath);
assert.equal(sha(providerBytes), providerSha);
const proof = JSON.parse(providerBytes);
const match = proof.fixtures.find(({ sha256 }) => sha256 === replaySha).match;
const providers = proof.rows.filter(
  (row) =>
    row.match === match &&
    row.stream === 2 &&
    row.chunk === keyframeChunk &&
    row.timeSeconds === keyframeTime &&
    row.opcode === 1158 &&
    row.teamSlot === 2 &&
    row.ownerId !== 0,
);
const byOwner = new Map(providers.map((row) => [row.ownerId, []]));
assert.equal(providers.length, 23);
assert.equal(byOwner.size, providers.length);

const placementsBytes = readFileSync(placementsPath);
const placements = JSON.parse(placementsBytes);
const sceneBytes = readFileSync(scenePath);
const scene = JSON.parse(sceneBytes);
assert.equal(scene.identity.replaySha256, replaySha);
assert.equal(scene.identity.build, replay.build);
assert.equal(scene.identity.protocol, replay.protocol);
const inflate = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
const prepared = prepareReplayForSeek(replayBuffer, inflate);
const turretSource = prepareNativeTerrainTurrets(prepared, placements);
const turretPlacements = new Map(
  turretSource.opening.map((row) => [row.context, row]),
);
const authored = new Map(
  placements.records.map((row) => [row.mapNameHash, row]),
);
const sceneEntities = new Map();
for (const [family, models] of Object.entries({
  structureModels: scene.structureModels,
  inhibitorModels: scene.inhibitorModels,
  nexusModels: scene.nexusModels,
  worldUnitModels: scene.worldUnitModels,
})) {
  for (const entity of models?.instances ?? []) {
    assert.ok(
      !sceneEntities.has(entity.context),
      "Duplicate exact scene context",
    );
    sceneEntities.set(entity.context, { family, entity });
  }
}
const decoderBytes = readFileSync(decoderPath);
const decodePosition = createPosition944Reader(decoderBytes, replay);
let opcode = null;
let context = 0;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, inflate),
)) {
  if (packet.blockOffset === 0) {
    opcode = null;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  const packets = byOwner.get(context);
  if (!packets || ![1, 2].includes(packet.stream)) continue;
  const xz = opcode === 944 ? decodePosition(packet.payload) : null;
  packets.push({
    opcode,
    stream: packet.stream,
    chunk: packet.chunkId,
    timeSeconds: packet.timeSeconds,
    offset: packet.blockOffset,
    bytes: packet.payload.length,
    sha256: sha(packet.payload),
    ...(xz ? { positionXZ: [xz.x, xz.z] } : {}),
  });
}

const rows = providers.map((provider) => {
  const { ownerId, providerId, offset, positionXZ } = provider;
  const packets = byOwner.get(ownerId);
  const opening = packets.filter(
    (packet) => packet.stream === 2 && packet.chunk === 1,
  );
  const keyframe = packets.filter(
    (packet) => packet.stream === 2 && packet.chunk === keyframeChunk,
  );
  const ordinary = packets.filter(
    (packet) => packet.stream === 1 && packet.timeSeconds <= keyframeTime,
  );
  const [openingPosition] = opening.filter((packet) => packet.positionXZ);
  const [keyframePosition] = keyframe.filter((packet) => packet.positionXZ);
  assert.ok(openingPosition && keyframePosition && ordinary.length > 0);
  assert.deepEqual(openingPosition.positionXZ, keyframePosition.positionXZ);
  const placement = turretPlacements.get(ownerId);
  const sceneEntity = sceneEntities.get(ownerId);
  let worldBinding = null;
  if (sceneEntity) {
    assert.equal(sceneEntity.family, "structureModels");
    assert.ok(placement);
    assert.deepEqual(sceneEntity.entity.position, placement.worldPosition);
    const staticRecord = authored.get(placement.mapNameHash);
    assert.equal(staticRecord.explicitTeam, 200);
    const [openingName] = opening.filter((packet) => packet.opcode === 921);
    const [keyframeName] = keyframe.filter((packet) => packet.opcode === 921);
    assert.ok(openingName && keyframeName);
    worldBinding = {
      family: sceneEntity.family,
      mapNameHash: placement.mapNameHash,
      authoredTeam: staticRecord.explicitTeam,
      authoredPositionXYZ: placement.worldPosition,
      openingName,
      keyframeName,
    };
  }
  return {
    providerId,
    ownerId,
    sourceEntityId: provider.sourceEntityId,
    postRegistrationOwnerId: Buffer.from(
      provider.postRegistrationWrites6c,
      "hex",
    ).readUInt32LE(),
    registrationOffset: offset,
    registrationPositionXZ: positionXZ,
    worldBinding,
    openingPosition,
    keyframePosition,
    matchesRegistrationXZ: positionXZ.every(
      (value, index) => value === keyframePosition.positionXZ[index],
    ),
    packetCensus: {
      opening,
      keyframe,
      ordinaryThroughKeyframe: ordinary,
    },
    nativeOwnerModifierRecovered: false,
    admittedTerrainContribution: false,
  };
});
const sceneBound = rows.filter((row) => row.worldBinding).length;
assert.equal(sceneBound, 11);
const report = {
  kind: "exact-build-fog-keyframe-owned-provider-census",
  build: replay.build,
  protocol: replay.protocol,
  match,
  replaySha256: replaySha,
  providerReceiptSha256: providerSha,
  decoderSha256: sha(decoderBytes),
  placementsSha256: sha(placementsBytes),
  sceneSha256: sha(sceneBytes),
  keyframe: {
    stream: 2,
    chunk: keyframeChunk,
    timeSeconds: keyframeTime,
    team: 200,
  },
  providerCount: rows.length,
  sceneBound,
  ownerPositionMatchesRegistration: rows.filter(
    (row) => row.matchesRegistrationXZ,
  ).length,
  requiredRuntimeState: {
    ownerLookupRva: "0x5587f0",
    ownerUpdateRva: "0x214200",
    sourceOfOwnerIdentity: "provider+0x3c after native registration",
    teamSelection: "owner+0x15c mapped through native team table",
    radiusModifier: "owner vtable+0x130, then component vtable+0x3e8",
    positionBranch:
      "owner+0x160/+0x168 or result of owner vtable+0x128 then movement vtable+0x690 and 0xac070",
    terrainEligibility: "0x21dcb0 and owner component vtable+0x2b8",
    teamWalkRva: "0x221900",
  },
  unresolvedSceneOwnerIds: rows
    .filter((row) => !row.worldBinding)
    .map((row) => row.ownerId),
  allProvidersWithNativeModifierUnresolved: rows.map((row) => row.providerId),
  rows,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
