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
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";

const [replayFile, replaySha256, byteMaps, nativeFile] = process.argv.slice(2);
assert.ok(
  replayFile &&
    /^[a-f0-9]{64}$/u.test(replaySha256 ?? "") &&
    ((byteMaps && nativeFile) || (!byteMaps && !nativeFile)),
  "Usage: bun verify-recorded-basic-attacks.mjs ROFL ROFL_SHA256 [BYTE_MAPS NATIVE_RECEIPT]",
);
const bytes = await readFile(replayFile);
assert.equal(
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  replaySha256,
);
const buffer = Uint8Array.from(bytes).buffer;
const replay = openReplay(buffer);
const decompress = (packet, output) =>
  zstdDecompressSync(packet, { maxOutputLength: output.length });
assert.equal(replay.build, "16.23.841.8428");
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
const { observations } = prepareReplayForSeek(buffer, decompress, {
  allowCurrentBuild: true,
});
const ids = new Set(
  observations.binding.verified.map(({ context }) => context),
);
assert.equal(ids.size, 10);
for (const id of ids) assert.ok(Number.isSafeInteger(id) && id > 0);
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
  if (
    packet.stream === 1 &&
    currentBasicAttackOpcodes.has(opcode) &&
    ids.has(context)
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
      ...nativeEnvelope
    } = expected[index];
    assert.deepEqual(
      { opcode, timeSeconds, sequence, ownerId, body },
      nativeEnvelope,
    );
    const actual = read(opcode, Buffer.from(body, "hex"));
    if (requestedSlot < 64 || requestedSlot > 81) {
      assert.equal(actual, null);
      continue;
    }
    assert.deepEqual(actual, {
      targetId,
      requestedSlot,
      timingOffsetCentiseconds,
    });
    owners.set(ownerId, (owners.get(ownerId) ?? 0) + 1);
  }
  console.log(
    JSON.stringify({
      replaySha256,
      packets: packets.length,
      attacks: [...owners.values()].reduce((total, count) => total + count, 0),
      owners: Object.fromEntries(owners),
    }),
  );
}
