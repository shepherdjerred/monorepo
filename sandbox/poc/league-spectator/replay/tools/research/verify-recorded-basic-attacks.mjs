import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import {
  createCurrentBasicAttackReader,
  currentBasicAttackOpcodes,
} from "./native-terrain-basic-attack-reader.mjs";
import {
  createPreparedTerrainByteCodecs,
  currentTerrainClientArchiveSha256,
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";

const [replayFile, replaySha256, ...argumentsLeft] = process.argv.slice(2);
const laneFlag = argumentsLeft.indexOf("--lanes");
const inputs =
  laneFlag === -1 ? argumentsLeft : argumentsLeft.slice(0, laneFlag);
const laneInputs = laneFlag === -1 ? [] : argumentsLeft.slice(laneFlag + 1);
const [byteMaps, nativeFile] = inputs;
const [laneFile, laneSha256] = laneInputs;
const digest = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
assert.ok(
  replayFile &&
    /^[a-f0-9]{64}$/u.test(replaySha256 ?? "") &&
    (inputs.length === 0 || inputs.length === 2) &&
    (laneFlag === -1 ||
      (laneInputs.length === 2 && /^[a-f0-9]{64}$/u.test(laneSha256))),
  "Usage: bun verify-recorded-basic-attacks.mjs ROFL ROFL_SHA256 [BYTE_MAPS NATIVE_RECEIPT] [--lanes LANE_EVIDENCE SHA256]",
);
const bytes = await readFile(replayFile);
assert.equal(digest(bytes), replaySha256);
const buffer = Uint8Array.from(bytes).buffer;
const replay = openReplay(buffer);
const decompress = (packet, output) =>
  zstdDecompressSync(packet, { maxOutputLength: output.length });
assert.equal(replay.build, "16.23.841.8428");
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
async function readOwners() {
  if (laneFile === undefined) {
    const { observations } = prepareReplayForSeek(buffer, decompress, {
      allowCurrentBuild: true,
    });
    const owners = new Map(
      observations.binding.verified.map(({ context }) => [
        context,
        [0, replay.duration],
      ]),
    );
    assert.equal(owners.size, 10);
    return owners;
  }
  const laneBytes = await readFile(laneFile);
  assert.equal(digest(laneBytes), laneSha256);
  const lane = JSON.parse(laneBytes);
  assert.equal(lane.kind, "exact-terrain-lane-minion-waypoint-evidence");
  assert.equal(lane.nativeReaderSha256, currentTerrainClientArchiveSha256);
  assert.equal(lane.build, replay.build);
  assert.equal(lane.protocol, replay.protocol);
  assert.equal(lane.replaySha256, replaySha256);
  const owners = new Map();
  for (const {
    context,
    creationTimeSeconds,
    killTimeSeconds,
  } of lane.instances) {
    assert.ok(
      !owners.has(context) && Number.isSafeInteger(context) && context > 0,
    );
    assert.ok(
      Number.isFinite(creationTimeSeconds) && Number.isFinite(killTimeSeconds),
    );
    assert.ok(
      creationTimeSeconds >= 0 &&
        killTimeSeconds > creationTimeSeconds &&
        killTimeSeconds <= replay.duration,
    );
    owners.set(context, [creationTimeSeconds, killTimeSeconds]);
  }
  assert.ok(owners.size > 0);
  return owners;
}
const lifetimes = await readOwners();
const packets = [];
let opcode;
let context = 0;
let sequence = 0;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, decompress),
)) {
  sequence++;
  if (packet.blockOffset === 0) {
    opcode = undefined;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  const life = lifetimes.get(context);
  if (
    packet.stream === 1 &&
    currentBasicAttackOpcodes.has(opcode) &&
    life !== undefined &&
    (laneFile === undefined ||
      (packet.timeSeconds >= life[0] && packet.timeSeconds < life[1]))
  )
    packets.push([
      opcode,
      packet.timeSeconds,
      sequence,
      context,
      Buffer.from(packet.payload).toString("hex"),
    ]);
}

if (nativeFile === undefined) {
  console.log(JSON.stringify(packets));
} else {
  const codecs = await createPreparedTerrainByteCodecs(
    await readFile(byteMaps),
    replay,
    { allowCurrentBuild: true },
  );
  const read = createCurrentBasicAttackReader(
    replay,
    recoverTerrainByteSubstitution(codecs),
  );
  const expected = JSON.parse(await readFile(nativeFile, "utf8"));
  assert.equal(packets.length, expected.length);
  const owners = new Map();
  for (const [
    index,
    [opcode, timeSeconds, sequence, ownerId, body],
  ] of packets.entries()) {
    const {
      targetId,
      requestedSlot,
      timingOffsetCentiseconds,
      embeddedCastCount = 0,
      sourceXZBits,
      ...nativeEnvelope
    } = expected[index];
    assert.deepEqual(
      { opcode, timeSeconds, sequence, ownerId, body },
      nativeEnvelope,
    );
    const actual = read(opcode, Buffer.from(body, "hex"));
    if (embeddedCastCount !== 0 || requestedSlot < 64 || requestedSlot > 81) {
      assert.equal(actual, null);
      continue;
    }
    assert.deepEqual(actual, {
      targetId,
      requestedSlot,
      timingOffsetCentiseconds,
      ...(sourceXZBits !== undefined && { sourceXZBits }),
    });
    owners.set(ownerId, (owners.get(ownerId) ?? 0) + 1);
  }
  console.log(
    JSON.stringify({
      replaySha256,
      packets: packets.length,
      attacks: [...owners.values()].reduce((total, count) => total + count, 0),
      ownerCount: owners.size,
      ...(laneFile === undefined && { owners: Object.fromEntries(owners) }),
    }),
  );
}
