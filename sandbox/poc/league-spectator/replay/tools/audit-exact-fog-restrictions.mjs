import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";

const [input, output] = process.argv.slice(2);
if (process.argv.length !== 4)
  throw Error(
    "Usage: bun audit-exact-fog-restrictions.mjs <saved-rofl> <new-output.json>",
  );
const bytes = readFileSync(input);
const replaySha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  replaySha256,
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
);
const replay = openReplay(Uint8Array.from(bytes).buffer);
assert.equal(replay.build, "16.23.840.6595");
assert.equal(replay.protocol, "8bbfcd5af2bc92db");

// The exact dispatcher table resolves these opcodes to the native restriction
// manager at 0x24e2a30. Its constructor initializes empty begin/end pointers.
const add = {
  opcode: 447,
  dispatchRva: 0x6e6eba,
  writerRva: 0x21e1a0,
  packets: 0,
};
const remove = {
  opcode: 598,
  dispatchRva: 0x6e5303,
  writerRva: 0x21dbd0,
  packets: 0,
};
let packetCount = 0;
let opcode = null;
for (const packet of replayPacketEnvelopes(replay, (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
)) {
  if (packet.blockOffset === 0) opcode = null;
  opcode = packet.explicitOpcode ?? opcode;
  if (opcode === add.opcode) add.packets += 1;
  if (opcode === remove.opcode) remove.packets += 1;
  packetCount += 1;
}
assert.equal(add.packets, 0);
assert.equal(remove.packets, 0);
const report = {
  replaySha256,
  build: replay.build,
  protocol: replay.protocol,
  packetCount,
  add,
  remove,
  originalManagerConstructionRange: [0x671e4f, 0x671e79],
  originalRestrictionOwnerLookupRva: 0x21dcb0,
  scope: {
    completeReplayPacketCensus: true,
    managerRuntimeStateRestored: false,
    ownerTerrainEligibilityReconstructed: false,
  },
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
