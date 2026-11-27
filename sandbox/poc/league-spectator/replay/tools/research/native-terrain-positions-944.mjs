import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  assertExactTerrainReplay,
  codecsFromTerrainByteMaps,
  currentTerrainClientArchiveSha256,
  currentTerrainClientSliceSha256,
  currentTerrainPositionBuild,
  preparedBytes,
  preparedSha256,
  terrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { createPosition944ReaderFromCodecs } from "./native-terrain-positions-944-reader.mjs";

const sliceOffset = 0x4000;
const sliceSize = 39_463_840;
const fatSize = 76_111_280;
const sliceSha256 =
  "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa";
const substitutionOffset = 0x2148f00;
const replicationSubstitutionOffset = 0x21485c0;
const substitutionSha256 =
  "328528d693ab5d96a815b6706694025a980e609019304aeb2e5e32797011c04b";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rotateLeft(byte, shift) {
  return ((byte << shift) | (byte >>> (8 - shift))) & 0xff;
}

function swapAdjacentBits(byte) {
  return ((byte >>> 1) & 0x55) | ((byte << 1) & 0xaa);
}

function createCodecsFromClient(clientBytes, build) {
  if (!(clientBytes instanceof Uint8Array))
    throw Error(`Expected local ${build} macOS client bytes`);
  const currentBuild = build === currentTerrainPositionBuild;
  const fat = clientBytes.length === fatSize;
  if (
    currentBuild &&
    fat &&
    sha256(clientBytes) !== currentTerrainClientArchiveSha256
  )
    throw Error("Unexpected current macOS client archive digest");
  const slice = fat
    ? clientBytes.subarray(sliceOffset, sliceOffset + sliceSize)
    : clientBytes;
  if (
    slice.length !== sliceSize ||
    sha256(slice) !==
      (currentBuild ? currentTerrainClientSliceSha256 : sliceSha256)
  )
    throw Error("Unexpected macOS client slice");
  const substitution = Uint8Array.from(
    slice.subarray(substitutionOffset, substitutionOffset + 256),
  );
  if (sha256(substitution) !== substitutionSha256)
    throw Error("Unexpected exact terrain byte substitution");
  if (
    currentBuild &&
    sha256(
      slice.subarray(
        replicationSubstitutionOffset,
        replicationSubstitutionOffset + 256,
      ),
    ) !== substitutionSha256
  )
    throw Error("Unexpected exact terrain replication byte substitution");

  const decodePositionByte = (byte) => {
    const rotated = rotateLeft((rotateLeft(byte ^ 0xff, 2) + 0xfe) & 0xff, 4);
    return (substitution[swapAdjacentBits(rotated ^ 0x19)] + 0x67) & 0xff;
  };
  const decodeSyncByte = (byte) =>
    (rotateLeft(substitution[(byte + 0x64) & 0xff] ^ 0xff, 6) + 0xed) & 0xff;
  // The opcode 309 readers reference a byte-identical copy at 0x21485c0.
  const decodeReplicationVectorByte = (byte) =>
    swapAdjacentBits(rotateLeft(substitution[substitution[byte ^ 0xad]], 2));
  const decodeReplicationTailByte = (byte) => {
    const index = (((byte << 1) | 0x54) + ((byte >>> 1) & 0x55)) & 0xff;
    return rotateLeft(substitution[index], 6);
  };
  return {
    decodePositionByte,
    decodeSyncByte,
    decodeReplicationVectorByte,
    decodeReplicationTailByte,
  };
}

function requirePreparedDigest(bytes) {
  if (bytes.length !== preparedBytes || sha256(bytes) !== preparedSha256)
    throw Error("Unexpected prepared exact terrain decoder digest");
}

/** Four 256-byte maps, indexed by wire byte, with no executable data. */
export function prepareExactTerrainDecoder(
  clientBytes,
  replay = { build: terrainPositionBuild, protocol: terrainPositionProtocol },
  options,
) {
  assertExactTerrainReplay(replay, options);
  const {
    decodePositionByte,
    decodeSyncByte,
    decodeReplicationVectorByte,
    decodeReplicationTailByte,
  } = createCodecsFromClient(clientBytes, replay.build);
  const bytes = new Uint8Array(preparedBytes);
  for (let byte = 0; byte < 256; byte++) {
    bytes[byte] = decodePositionByte(byte);
    bytes[256 + byte] = decodeSyncByte(byte);
    bytes[512 + byte] = decodeReplicationVectorByte(byte);
    bytes[768 + byte] = decodeReplicationTailByte(byte);
  }
  requirePreparedDigest(bytes);
  return bytes;
}

export function createExactTerrainByteCodecs(decoderBytes, replay, options) {
  assertExactTerrainReplay(replay, options);
  if (
    !(decoderBytes instanceof Uint8Array) ||
    decoderBytes.length !== preparedBytes
  )
    return createCodecsFromClient(decoderBytes, replay.build);
  const maps = Uint8Array.from(decoderBytes);
  requirePreparedDigest(maps);
  return codecsFromTerrainByteMaps(maps);
}

export function createPosition944Reader(decoderBytes, replay, options) {
  return createPosition944ReaderFromCodecs(
    createExactTerrainByteCodecs(decoderBytes, replay, options),
  );
}

export async function loadPosition944Reader(decoderPath, replay, options) {
  return createPosition944Reader(await readFile(decoderPath), replay, options);
}
