import {
  currentTerrainPositionBuild,
  rotateByteLeft,
  swapAdjacentBits,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

// Opcode 880 .8428 reader 0x11c9f00 and enum consumer at 0x3d1e48.
const eventDefaults = [0x4343, 0x8383, 0x43c2, 0x4303];
const explicitContextModes = new Set([1, 4, 6, 7]);
const explicitTrailingModes = new Set([0, 1, 3, 4, 5, 6]);
const decodeEventByte = (byte) =>
  (rotateByteLeft(rotateByteLeft(byte, 4) ^ 0xff, 6) + 0x0e) & 0xff;

export function createCurrentAnnouncement880Reader(replay, substitution) {
  if (
    replay?.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol
  )
    throw Error(
      "Expected the reviewed current announcement build and protocol",
    );
  if (!(substitution instanceof Uint8Array) || substitution.length !== 256)
    throw Error("Expected an authenticated announcement byte substitution");

  // Native blob reader 0x12a6a20, context argument 0x129ef20, trailing argument 0x1298560.
  const blobByte = (byte) =>
    (substitution[
      substitution[
        substitution[rotateByteLeft(rotateByteLeft(byte, 4) ^ 0xff, 2)]
      ]
    ] +
      0xf3) &
    0xff;
  const contextByte = (byte) =>
    ((substitution[substitution[swapAdjacentBits(byte ^ 0xe0)]] + 0x34) &
      0xff) ^
    0x77;
  const trailingByte = (byte) =>
    ((substitution[swapAdjacentBits((0xaf - byte) & 0xff) ^ 0xff] + 0xc7) &
      0xff) ^
    0x41;

  return function readAnnouncement(body) {
    if (!(body instanceof Uint8Array) || body.length < 2) return null;
    const [first, second] = body;
    let cursor = 2;
    function readVarUint(decode, maxBytes, maximum, terminalBit = 0) {
      let value = 0;
      for (let index = 0; index < maxBytes && cursor < body.length; index++) {
        const byte = decode(body[cursor++]);
        value += (byte & 0x7f) * 2 ** (7 * index);
        if (value > maximum) return null;
        if ((byte & 0x80) === terminalBit) return value;
      }
      return null;
    }

    const eventMode = (first >>> 7) | ((second & 3) << 1);
    const encodedDefault = eventDefaults[eventMode];
    const event =
      encodedDefault === undefined
        ? readVarUint(decodeEventByte, 3, 0xffff)
        : decodeEventByte(encodedDefault & 0xff) |
          (decodeEventByte(encodedDefault >>> 8) << 8);
    if (event === null) return null;

    // These fields don't change the enum. Consume them so a partial
    // announcement or trailing bytes cannot trigger an authored clip.
    if ((first & 0x40) === 0) {
      const length = readVarUint(blobByte, 5, 0xffffffff);
      if (length === null || length > body.length - cursor) return null;
      cursor += length;
    }
    if (
      explicitContextModes.has((first >>> 3) & 7) &&
      readVarUint(contextByte, 5, 0xffffffff) === null
    )
      return null;
    if (
      explicitTrailingModes.has(first & 7) &&
      readVarUint(trailingByte, 5, 0xffffffff, 0x80) === null
    )
      return null;
    return cursor === body.length ? event : null;
  };
}

/** Consume original timed envelopes for a separately authenticated Map11 audio catalog. */
export function createCurrentMap11AnnouncerCollector(
  replay,
  substitution,
  mediaByEvent,
) {
  const readAnnouncement = createCurrentAnnouncement880Reader(
    replay,
    substitution,
  );
  const { duration } = replay;
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error("Invalid announcement replay duration");
  const cues = [];
  const omittedByEvent = new Map();
  let rejectedBodies = 0;
  let opcode;
  let context = 0;
  return {
    observe(packet) {
      if (packet.blockOffset === 0) {
        opcode = undefined;
        context = 0;
      }
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      if (packet.stream !== 1 || opcode !== 880 || context !== 0) return;
      const event = readAnnouncement(packet.payload);
      const { timeSeconds, chunkOffset, blockOffset } = packet;
      if (
        event === null ||
        !Number.isFinite(timeSeconds) ||
        timeSeconds < 0 ||
        timeSeconds > duration
      ) {
        rejectedBodies++;
        return;
      }
      const mediaId = mediaByEvent.get(event);
      if (mediaId === undefined) {
        omittedByEvent.set(event, (omittedByEvent.get(event) ?? 0) + 1);
        return;
      }
      if (!Number.isInteger(mediaId) || mediaId <= 0 || mediaId > 0xffffffff)
        throw Error("Invalid authored announcement media ID");
      cues.push({ event, mediaId, timeSeconds, chunkOffset, blockOffset });
    },
    finish() {
      return {
        cues,
        omittedByEvent: Object.fromEntries(omittedByEvent),
        rejectedBodies,
      };
    },
  };
}
