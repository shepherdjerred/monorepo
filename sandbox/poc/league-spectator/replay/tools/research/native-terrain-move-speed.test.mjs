import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMoveSpeed309Reader,
  loadMoveSpeed309Reader,
} from "./native-terrain-move-speed.mjs";
import { createMoveSpeed309ReaderFromCodecs } from "./native-terrain-move-speed-reader.mjs";

const replay = { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" };

test("requires the pinned client slice and replay", () => {
  const bytes = new Uint8Array();
  assert.throws(
    () =>
      createMoveSpeed309Reader(bytes, { ...replay, build: "16.23.839.9929" }),
    /replay protocol/,
  );
  assert.throws(
    () => createMoveSpeed309Reader(bytes, replay),
    /macOS client slice/,
  );
});

const clientPath = process.env.SCOUT_RESEARCH_OPCODE944_MAC_CLIENT;

const readWithIdentityBytes = createMoveSpeed309ReaderFromCodecs({
  decodeReplicationVectorByte: (byte) => byte,
  decodeReplicationTailByte: (byte) => byte,
});

function oneRecord(groups) {
  const record = [
    groups.reduce((flags, [group]) => flags | group, 0),
    7,
    0,
    0,
    0,
  ];
  for (const [, mask, bytes] of groups)
    record.push(
      mask & 255,
      (mask >>> 8) & 255,
      (mask >>> 16) & 255,
      mask >>> 24,
      bytes.length,
      ...bytes,
    );
  const interleaved = record.map(
    (_, index) =>
      record[index & 1 ? record.length - 1 - (index >>> 1) : index >>> 1],
  );
  return Uint8Array.of(0xf0, 1, record.length, ...interleaved);
}

test("opts into verified champion group 1 and 32 stats with the same speed reads", () => {
  const body = oneRecord([
    [1, 1, [0x00, 0x00, 0x80, 0x3f]],
    [
      32,
      (1 << 24) | (1 << 15) | 3,
      [255, 0, 0, 0x80, 0x3f, 255, 0, 0, 0x80, 0x3f],
    ],
  ]);
  const ids = new Set([7]);
  const standard = readWithIdentityBytes(body, ids);
  assert.deepEqual(standard, {
    recordCount: 1,
    championGroups: 1,
    updates: [{ entityId: 7, recordIndex: 0, moveSpeed: 1 }],
  });
  const options = { includeChampionStats: true };
  assert.deepEqual(readWithIdentityBytes(body, ids, options), {
    ...standard,
    statsWrites: [
      { entityId: 7, gold: 1 },
      { entityId: 7, health: 0, healthMax: 1, resource: 0 },
    ],
  });
  assert.deepEqual(
    readWithIdentityBytes(body, new Set(), options).statsWrites,
    [],
  );
});

test("rejects malformed registered stat payload when it is requested", () => {
  const ids = new Set([7]);
  const options = { includeChampionStats: true };
  for (const [mask, payload, error] of [
    [1, [254, 0], /Truncated state field/],
    [1, [255, 0], /unexpected trailing bytes/],
    [0x10000001, [255], /Unregistered replication field/],
  ]) {
    const body = oneRecord([[1, mask, payload]]);
    assert.doesNotThrow(() => readWithIdentityBytes(body, ids));
    assert.throws(() => readWithIdentityBytes(body, ids, options), error);
  }
});

test(
  "requires verified contexts and consistent opcode 309 bounds and counts",
  { skip: !clientPath },
  async () => {
    const read = await loadMoveSpeed309Reader(clientPath, replay);
    const verified = new Set();
    const empty = Uint8Array.of(0x71, 3);
    assert.deepEqual(read(empty, verified), {
      recordCount: 0,
      championGroups: 0,
      updates: [],
    });
    assert.throws(() => read(empty, []), /verified champion ID set/);
    assert.throws(() => read(empty.subarray(0, 1), verified), /Truncated/);
    assert.throws(
      () => read(Uint8Array.of(0x71, 3, 0), verified),
      /inconsistent length/,
    );
    assert.throws(
      () => read(Uint8Array.of(0xf1, 1), verified),
      /record count mismatch/,
    );
    assert.throws(() => read(Uint8Array.of(0x70, 3), verified), /varuint/);
  },
);
