import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWaypointReader,
  loadWaypointReader,
} from "./native-terrain-waypoints.mjs";

const replay = { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" };

test("rejects mismatched replay and unpinned client inputs", () => {
  const bytes = new Uint8Array(1);
  assert.throws(
    () => createWaypointReader(bytes, { ...replay, build: "16.23.839.9929" }),
    /replay protocol/,
  );
  assert.throws(
    () => createWaypointReader(bytes, replay),
    /macOS client slice/,
  );
});

function syntheticBody(opcode) {
  const offset = opcode === 1174 ? 56 : 0;
  const record = Buffer.alloc(17 + offset);
  record.writeUInt16LE(4);
  record.writeUInt32LE(0x40000042, 2);
  record.writeFloatLE(300, 6);
  if (offset) record.writeFloatLE(500, 10);
  // Both axes use signed deltas after the absolute first pair.
  record[10 + offset] = 3;
  record.writeInt16LE(-240, 11 + offset);
  record.writeInt16LE(710, 13 + offset);
  record.writeInt8(-30, 15 + offset);
  record.writeInt8(27, 16 + offset);
  const body = [0x5f, (record.length - 0x69) & 0xff];
  for (let start = 0, end = record.length - 1; start <= end; start++, end--) {
    body.push((record[start] - 0x69) & 0xff);
    if (start !== end) body.push((record[end] - 0x69) & 0xff);
  }
  return Uint8Array.from(body);
}

const clientPath = process.env.SCOUT_RESEARCH_OPCODE944_MAC_CLIENT;
test(
  "decodes both waypoint variants and rejects malformed packet bodies",
  { skip: !clientPath },
  async () => {
    const read = await loadWaypointReader(clientPath, replay);
    const normal = syntheticBody(96);
    for (const opcode of [96, 1174]) {
      const { syncId, records } = read(opcode, syntheticBody(opcode));
      assert.equal(syncId, 0);
      assert.equal(records.length, 1);
      const [record] = records;
      assert.equal(record.entityId, 0x40000042);
      assert.equal(record.speed, 300);
      assert.equal(record.motion?.speed ?? null, opcode === 1174 ? 500 : null);
      assert.deepEqual(record.encodedWaypoints, [
        [-240, 710],
        [-270, 737],
      ]);
    }

    assert.throws(() => read(944, normal), /opcode/);
    assert.throws(() => read(96, new Uint8Array()), /Truncated/);
    assert.throws(() => read(96, Uint8Array.of(0x80)), /header flag/);
    assert.throws(() => read(96, normal.subarray(0, 1)), /waypoint field/);
    assert.throws(() => read(96, normal.subarray(0, -1)), /vector length/);
    normal[0] = 0x5d;
    assert.throws(() => read(96, normal), /record count/);
  },
);
