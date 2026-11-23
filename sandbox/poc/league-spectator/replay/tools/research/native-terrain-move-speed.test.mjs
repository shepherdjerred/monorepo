import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMoveSpeed309Reader,
  loadMoveSpeed309Reader,
} from "./native-terrain-move-speed.mjs";

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
