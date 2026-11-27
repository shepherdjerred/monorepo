import assert from "node:assert/strict";
import test from "node:test";
import { position944SubstitutionIndex } from "./native-terrain-byte-codecs.mjs";
import { createCurrentLaneMinionPacketReader } from "./recorded-lane-minion-packets.mjs";

const current = { build: "16.23.841.8428", protocol: "8bbfcd5af2bc92db" };
const identityCodecs = {
  decodePositionByte: (byte) =>
    (position944SubstitutionIndex(byte) + 0x67) & 0xff,
};
const reader = createCurrentLaneMinionPacketReader(current, identityCodecs);
const read = (opcode, hex) => reader(opcode, Buffer.from(hex, "hex"));

test("decodes current creation and death preset branches and explicit removal", () => {
  assert.deepEqual(read(189, "69a20000"), {
    entity: 2981212593,
    unitType: 2,
    barracks: 3082270647,
  });
  assert.deepEqual(read(1197, "6700"), { relatedEntity: 2391707278 });
  assert.deepEqual(read(117, "fcdf1a"), { entity: 1073742605 });
});

test("rejects unknown opcodes, unsupported builds, missing fields, and trailing bytes", () => {
  assert.throws(
    () => read(66, "77db"),
    /unsupported recorded lane packet opcode/i,
  );
  assert.throws(
    () =>
      createCurrentLaneMinionPacketReader(
        { ...current, build: "16.23.840.6595" },
        identityCodecs,
      ),
    /exact \.8428/,
  );
  assert.throws(() => read(189, "69a200"), /truncated lane creation header/i);
  assert.throws(() => read(1197, "67"), /truncated lane death header/i);
  assert.throws(() => read(117, "fcdf"), /truncated lane packet field/i);
  assert.throws(() => read(117, "fcdf1a00"), /trailing lane packet bytes/i);
});
