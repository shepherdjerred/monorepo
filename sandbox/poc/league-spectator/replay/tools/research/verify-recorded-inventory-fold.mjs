import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import {
  createPreparedTerrainByteCodecs,
  currentTerrainPositionBuild,
} from "./native-terrain-byte-codecs.mjs";
import { foldRecordedInventory } from "./recorded-inventory-fold.mjs";
import { verifyRecordedInventoryFooter } from "./verify-recorded-inventory-footer.mjs";

const args = Bun.argv.slice(2);
assert.ok(
  args.length === 6 || args.length === 7,
  "Supply the original ROFL, bound scene, native receipt and pin, audited tracks and pin, and optionally the exact portable decoder bytes.",
);
const [
  replayPath,
  scenePath,
  nativePath,
  nativePin,
  tracksPath,
  tracksPin,
  decoderPath,
] = args;
const sha256 = (data) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });
async function readPinnedJson(path, expected) {
  assert.match(expected, /^[a-f0-9]{64}$/u, "Invalid inventory evidence pin.");
  const bytes = await Bun.file(path).bytes();
  assert.equal(sha256(bytes), expected, "Inventory evidence digest differs.");
  return JSON.parse(decoder.decode(bytes));
}
const native = await readPinnedJson(nativePath, nativePin);
const tracks = await readPinnedJson(tracksPath, tracksPin);
const scene = await readPinnedJson(scenePath, native.sceneSha256);
const bytes = await Bun.file(replayPath).arrayBuffer();
const replaySha256 = sha256(bytes);
const replay = openReplay(bytes);
assert.equal(replay.build, currentTerrainPositionBuild);
for (const identity of [native, tracks, scene.identity]) {
  assert.equal(identity.replaySha256, replaySha256);
  assert.equal(identity.build, replay.build);
  assert.equal(identity.protocol, replay.protocol);
}
assert.equal(scene.identity.durationMilliseconds, replay.durationMilliseconds);
assert.equal(scene.identity.participantCount, 10);
const participants = new Set(
  scene.participants.map(({ participantId }) => participantId),
);
assert.equal(participants.size, 10);
assert.deepEqual(new Set(native.participants), participants);

async function readPortableDecoder() {
  if (decoderPath === undefined) return;
  const { createCurrentInventoryPacketReader } =
    await import("./native-terrain-inventory-packet-reader.mjs");
  const codecs = await createPreparedTerrainByteCodecs(
    await Bun.file(decoderPath).bytes(),
    replay,
    { allowCurrentBuild: true },
  );
  return createCurrentInventoryPacketReader(replay, codecs);
}
const readPortable = await readPortableDecoder();
const portableRows = [];

// Check the native oracle preserved the original on-disk event order and
// clocks, independently of the JS mutation readers and ordered-state fold.
const inventoryOpcodes = new Set([190, 226, 248, 415, 797, 840, 1143, 1214]);
const envelopeFields = [
  "opcode",
  "context",
  "stream",
  "timeSeconds",
  "secondTimeBits",
  "chunkOffset",
  "blockOffset",
];
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
let inheritedOpcode;
let context;
let matchedPackets = 0;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, decompress),
)) {
  if (packet.blockOffset === 0) {
    inheritedOpcode = undefined;
    context = 0;
  }
  inheritedOpcode = packet.explicitOpcode ?? inheritedOpcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (!inventoryOpcodes.has(inheritedOpcode) || !participants.has(context))
    continue;
  const row = native.rows[matchedPackets];
  assert.ok(row, "Original replay contains additional inventory rows.");
  const envelope = { ...packet, opcode: inheritedOpcode, context };
  assert.ok(
    envelopeFields.every((key) => row[key] === envelope[key]),
    "Native receipt event order, identity or clock differs from original packet.",
  );
  if (readPortable !== undefined) {
    const identity = Object.fromEntries(
      envelopeFields.map((key) => [key, envelope[key]]),
    );
    let fields;
    try {
      fields = readPortable(inheritedOpcode, packet.payload);
    } catch (cause) {
      throw Error(
        `Portable inventory reader rejected packet ${matchedPackets} (opcode ${inheritedOpcode}, stream ${packet.stream}, width ${packet.payload.length})`,
        { cause },
      );
    }
    const portable = { ...identity, ...fields };
    assert.deepEqual(
      portable,
      row,
      "Portable inventory row differs from the native receipt.",
    );
    portableRows.push(portable);
  }
  matchedPackets++;
}
assert.equal(matchedPackets, native.rows.length);
const opening = native.rows.find(
  ({ stream, timeSeconds }) => stream === 2 && timeSeconds === 0,
);
assert.ok(opening, "Native receipt lacks an original opening inventory.");
const visible = foldRecordedInventory(
  readPortable === undefined ? native.rows : portableRows,
  {
    participantIds: native.participants,
    openingChunkOffset: opening.chunkOffset,
    durationSeconds: replay.durationMilliseconds / 1000,
  },
);
assert.deepEqual(visible.tracks, tracks.tracks);
const final = verifyRecordedInventoryFooter(
  new Uint8Array(bytes),
  scene.participants,
  visible.tracks,
);
const visibleStates = visible.tracks.reduce(
  (count, track) => count + track.points.length,
  0,
);
assert.equal(final.length, 10);
process.stdout.write(
  `${JSON.stringify({ matchedPackets, portableRows: portableRows.length, visibleStates, terminalSlots: final.length * 7 })}\n`,
);
