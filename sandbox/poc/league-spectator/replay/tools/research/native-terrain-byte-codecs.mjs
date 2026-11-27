export const terrainPositionBuild = "16.23.840.6595";
export const currentTerrainPositionBuild = "16.23.841.8428";
export const terrainPositionProtocol = "8bbfcd5af2bc92db";
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
