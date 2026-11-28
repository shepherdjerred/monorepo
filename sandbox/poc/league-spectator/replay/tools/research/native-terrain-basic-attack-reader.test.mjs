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
  "joins recorded layouts to native targets, slots, timing and lane coordinates",
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
      sourceXZBits,
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
      [
        359,
        "a5f7698f7f9773a80ef725fe15b3fca83c171bc172955b7c914cc3f2454c",
        1073742591,
        64,
        0,
        [1172854514, 1172934111],
      ],
    ]) {
      const bytes = Buffer.from(hex, "hex");
      assert.deepEqual(read(opcode, bytes), {
        targetId,
        requestedSlot,
        timingOffsetCentiseconds,
        ...(sourceXZBits !== undefined && { sourceXZBits }),
      });
      assert.equal(read(opcode, bytes.subarray(0, -1)), null);
      assert.equal(read(opcode, Uint8Array.of(...bytes, 0)), null);
    }
    assert.equal(
      read(
        195,
        Buffer.from(
          "c264668f461aa98453f0a9a9c4fea906a9f0dfc9995097da8f3e2623c24e90089c7a64d11cfdf19a661debe588f5dd38c2968e491572733b3970efa4ef38efefa2f3ef63e838e3e39ce3dd0a6952cfc7fd54b5c650032c494d66625cd302409c49b871fae4035470101764213499c9c90c4181654eba0754f7e575d656593d3f6c44dfa3e403",
          "hex",
        ),
      ),
      null,
    );
  },
);
