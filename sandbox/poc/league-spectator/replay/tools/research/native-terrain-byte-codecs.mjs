export const terrainPositionBuild = "16.23.840.6595";
export const currentTerrainPositionBuild = "16.23.841.8428";
export const terrainPositionProtocol = "8bbfcd5af2bc92db";
export const currentTerrainClientSliceSha256 =
  "de6db1683eb61358d0aaf9fac44ef722850a927263eae7f68212add8621a500e";
export const currentTerrainClientArchiveSha256 =
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7";
export const preparedBytes = 1024;
export const preparedSha256 =
  "14d1c21833a71917e12ff44a3ae8d9a6c40ee2401d94f0b3824991022c1c124c";

export function isExactTerrainReplay(
  replay,
  { allowCurrentBuild = false } = {},
) {
  return (
    replay?.protocol === terrainPositionProtocol &&
    (replay.build === terrainPositionBuild ||
      (allowCurrentBuild && replay.build === currentTerrainPositionBuild))
  );
}

export function assertExactTerrainReplay(
  replay,
  { allowCurrentBuild = false } = {},
) {
  if (!isExactTerrainReplay(replay, { allowCurrentBuild }))
    throw Error(
      allowCurrentBuild
        ? `Expected exact ${terrainPositionBuild} or ${currentTerrainPositionBuild} replay protocol`
        : `Expected exact ${terrainPositionBuild} replay protocol`,
    );
}

export function rotateByteLeft(byte, shift) {
  return ((byte << shift) | (byte >>> (8 - shift))) & 0xff;
}

export function swapAdjacentBits(byte) {
  return ((byte >>> 1) & 0x55) | ((byte << 1) & 0xaa);
}

export function position944SubstitutionIndex(byte) {
  const rotated = rotateByteLeft(
    (rotateByteLeft(byte ^ 0xff, 2) + 0xfe) & 0xff,
    4,
  );
  return swapAdjacentBits(rotated ^ 0x19);
}

/** Recover the original byte table from the authenticated position codec. */
export function recoverTerrainByteSubstitution({ decodePositionByte }) {
  const substitution = new Uint8Array(256);
  for (let byte = 0; byte < substitution.length; byte++) {
    substitution[position944SubstitutionIndex(byte)] =
      (decodePositionByte(byte) - 0x67) & 0xff;
  }
  return substitution;
}

/** Used by loaders only after authenticating a copy of the map bytes. */
export function codecsFromTerrainByteMaps(maps) {
  return {
    decodePositionByte: (byte) => maps[byte],
    decodeSyncByte: (byte) => maps[256 + byte],
    decodeReplicationVectorByte: (byte) => maps[512 + byte],
    decodeReplicationTailByte: (byte) => maps[768 + byte],
  };
}

/** Verify the exact prepared maps before creating browser worker readers. */
export async function createPreparedTerrainByteCodecs(bytes, replay, options) {
  assertExactTerrainReplay(replay, options);
  if (!(bytes instanceof Uint8Array) || bytes.length !== preparedBytes)
    throw Error("Unexpected prepared exact terrain decoder size");
  const maps = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", maps));
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hex !== preparedSha256)
    throw Error("Unexpected prepared exact terrain decoder digest");
  return codecsFromTerrainByteMaps(maps);
}
