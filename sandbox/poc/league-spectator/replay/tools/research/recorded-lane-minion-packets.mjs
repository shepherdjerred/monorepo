import {
  assertExactTerrainReplay,
  currentTerrainPositionBuild,
  recoverTerrainByteSubstitution,
  rotateByteLeft as rotate,
  swapAdjacentBits as swap,
} from "./native-terrain-byte-codecs.mjs";

function readFields(payload, offset) {
  const take = (width = 1) => {
    if (offset + width > payload.length)
      throw Error("Truncated lane packet field");
    const value = payload[offset];
    offset += width;
    return value;
  };
  return {
    take,
    varint(transform, maximumBytes) {
      let result = 0;
      for (let index = 0; index < maximumBytes; index++) {
        const byte = transform(take());
        result += (byte & 0x7f) * 2 ** (7 * index);
        if ((byte & 0x80) === 0) return result;
      }
      throw Error("Unterminated lane packet varint");
    },
    finish() {
      if (offset !== payload.length) throw Error("Trailing lane packet bytes");
    },
  };
}

function actorId(value) {
  if (value > 0xffffffff) throw Error("Lane actor ID exceeds uint32");
  return (value & 0xffffff) === 0 ? value : (value ^ 0x40000000) >>> 0;
}

const removalByte = (byte) =>
  (0x88 - rotate(((rotate(byte, 4) ^ 0xd2) + 0xce) & 0xff, 1)) & 0xff;

function readRemoval(payload) {
  if (payload.length === 0) throw Error("Missing lane removal header");
  const fields = readFields(payload, 1);
  const selector = payload[0] & 7;
  let entity;
  if (selector === 1 || selector === 7) {
    entity = removalByte(selector === 1 ? 0x4a : 0x42) * 0x01010101;
  } else {
    entity = actorId(fields.varint(removalByte, 5));
  }
  fields.finish();
  return { entity };
}

function readCreation(payload, substitution) {
  if (payload.length < 4) throw Error("Truncated lane creation header");
  const [first, second, third, fourth] = payload;
  const fields = readFields(payload, 4);
  if ([1, 2, 5, 6].includes(third >>> 5)) fields.take();
  if ([1, 3, 5, 6].includes((third >>> 2) & 7)) fields.take();
  const entitySelector = fourth & 7;
  const entity =
    entitySelector === 0 || entitySelector === 4
      ? ((substitution[
          (rotate((entitySelector === 0 ? 0xbb : 0xf3) ^ 0xff, 7) + 0x4e) & 0xff
        ] +
          0x41) &
          0xff) *
        0x01010101
      : actorId(
          fields.varint(
            (byte) =>
              (substitution[(rotate(byte ^ 0xff, 7) + 0x4e) & 0xff] + 0x41) &
              0xff,
            5,
          ),
        );
  const typeSelector = first & 7;
  const typePresets = [null, 0x51, null, null, 0x18, 0x98, 0xd8, null];
  const rawType = typePresets[typeSelector] ?? fields.take();
  const unitType =
    (0xbd - rotate(swap(((swap(rawType) + 0x32) & 0xff) ^ 9), 2)) & 0xff;
  if ([2, 3, 4, 7].includes((first >>> 6) + 4 * (second & 1)))
    fields.varint((byte) => rotate(byte ^ 0xeb, 3) ^ 0xff, 3);
  const barracksByte = (byte) =>
    substitution[
      (rotate(substitution[swap((byte + 0x4f) & 0xff)], 4) + 0xb8) & 0xff
    ];
  const barracksSelector = (second >>> 1) & 7;
  const barracks =
    barracksSelector === 1 || barracksSelector === 6
      ? barracksByte(barracksSelector === 1 ? 0xb0 : 0xbb) * 0x01010101
      : actorId(fields.varint(barracksByte, 5));
  if ([0, 2, 4, 6].includes((second >>> 7) + 2 * (third & 3)))
    fields.varint(
      (byte) =>
        (substitution[rotate(substitution[rotate(byte, 1)], 3)] + 0xd2) & 0xff,
      3,
    );
  if ([1, 4, 5, 7].includes((second >>> 4) & 7)) fields.take(4);
  if ([1, 2, 4, 6].includes((first >>> 3) & 7)) fields.take();
  fields.finish();
  return { entity, unitType, barracks };
}

function readDeathDetails(fields, substitution) {
  const first = fields.take();
  const second = fields.take();
  const third = fields.take();
  if ([0, 1, 4, 6].includes(second >>> 5)) fields.take();
  if ([0, 4, 6, 7].includes((first >>> 6) + 4 * (second & 1))) fields.take();
  if (third & 1)
    fields.varint((byte) => substitution[rotate((byte + 0xd3) & 0xff, 2)], 5);
  if ((second & 2) === 0) fields.take(12);
  if ([0, 3, 4, 6].includes((third >>> 1) & 7))
    fields.varint(
      (byte) =>
        swap((rotate((rotate(byte, 6) + 0x32) & 0xff, 7) + 0xbc) & 0xff),
      5,
    );
  if ([1, 2, 3, 4].includes((first >>> 3) & 7))
    fields.varint(
      (byte) => rotate(((swap(byte ^ 0x9a) + 0x7b) & 0xff) ^ 5, 7),
      5,
    );
  if ([1, 2, 5, 6].includes(first & 7)) fields.take(4);
  if ([0, 2, 4, 6].includes((second >>> 2) & 7))
    fields.varint(
      (byte) => substitution[rotate((substitution[byte ^ 5] + 0xa7) & 0xff, 3)],
      5,
    );
}

function readDeath(payload, substitution) {
  if (payload.length < 2) throw Error("Truncated lane death header");
  const [first, second] = payload;
  const fields = readFields(payload, 2);
  if ((first & 0x20) === 0)
    fields.varint((byte) => rotate(swap(rotate(byte, 7)) ^ 0x67, 1), 5);
  if ((first & 0x40) === 0) fields.take(12);
  if ([3, 4, 5, 6].includes((first >>> 7) + 2 * (second & 3))) fields.take(4);
  if ((first & 1) === 0) readDeathDetails(fields, substitution);
  const relatedByte = (byte) =>
    substitution[substitution[substitution[(0xea - byte) & 0xff]] ^ 0x17];
  const selector = (first >>> 1) & 7;
  const relatedEntity =
    selector === 1 || selector === 3
      ? relatedByte(selector === 1 ? 0xcc : 0x51) * 0x01010101
      : actorId(fields.varint(relatedByte, 5));
  fields.finish();
  return { relatedEntity };
}

/** Original Map11 lane creation, death, and removal bodies for the current build. */
export function createCurrentLaneMinionPacketReader(replay, codecs) {
  assertExactTerrainReplay(replay, { allowCurrentBuild: true });
  if (replay.build !== currentTerrainPositionBuild)
    throw Error("Recorded lane packet reader requires the exact .8428 build");
  const substitution = recoverTerrainByteSubstitution(codecs);
  return (opcode, payload) => {
    if (opcode === 189) return readCreation(payload, substitution);
    if (opcode === 117) return readRemoval(payload);
    if (opcode === 1197) return readDeath(payload, substitution);
    throw Error("Unsupported recorded lane packet opcode");
  };
}
