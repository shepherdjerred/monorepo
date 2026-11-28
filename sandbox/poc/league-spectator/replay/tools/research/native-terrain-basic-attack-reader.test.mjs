import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createCurrentBasicAttackReader } from "./native-terrain-basic-attack-reader.mjs";
import {
  createPreparedTerrainByteCodecs,
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";

const replay = { build: "16.23.841.8428", protocol: "8bbfcd5af2bc92db" };

test("requires exact replay provenance and an authenticated substitution map", () => {
  const substitution = Uint8Array.from({ length: 256 }, (_, byte) => byte);
  assert.throws(
    () =>
      createCurrentBasicAttackReader(
        { ...replay, build: "16.23.840.6595" },
        substitution,
      ),
    /exact current replay/,
  );
  assert.throws(
    () => createCurrentBasicAttackReader(replay, new Uint8Array(255)),
    /authenticated basic attack/,
  );
  const read = createCurrentBasicAttackReader(replay, substitution);
  assert.equal(read(992, new Uint8Array()), null);
  assert.equal(read(98, Uint8Array.of(0xa5, 0xf7, 0x9b, 0x8e)), null);
  assert.equal(read(992, Uint8Array.of(0xa5, 0xf7, 0x9f, 0x8e)), null);
  assert.equal(read(487, Uint8Array.of(0xa5, 0xf7, 0x9b, 0x8e)), null);
});

const maps = process.env.SCOUT_RESEARCH_8428_TERRAIN_DECODER;
test(
  "joins both recorded attack layouts to their native target, slot and timing",
  { skip: !maps },
  async () => {
    const codecs = await createPreparedTerrainByteCodecs(
      await readFile(maps),
      replay,
      {
        allowCurrentBuild: true,
      },
    );
    const read = createCurrentBasicAttackReader(
      replay,
      recoverTerrainByteSubstitution(codecs),
    );
    for (const [
      opcode,
      hex,
      targetId,
      requestedSlot,
      timingOffsetCentiseconds,
    ] of [
      [
        992,
        "a5f79b8ea84ba28df05fc0b6feda5ba9a83cfc9bc18a035408d432cc1e294c",
        1073742165,
        64,
        0,
      ],
      [
        98,
        "c267208edbadee83f05ed3b9feb51b7ea8bf057efd3199",
        1073742861,
        65,
        -2,
      ],
    ]) {
      const bytes = Buffer.from(hex, "hex");
      assert.deepEqual(read(opcode, bytes), {
        targetId,
        requestedSlot,
        timingOffsetCentiseconds,
      });
      assert.equal(read(opcode, bytes.subarray(0, -1)), null);
      assert.equal(read(opcode, Uint8Array.of(...bytes, 0)), null);
    }
  },
);
