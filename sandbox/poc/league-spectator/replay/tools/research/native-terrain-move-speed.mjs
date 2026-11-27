import { readFile } from "node:fs/promises";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { createMoveSpeed309ReaderFromCodecs } from "./native-terrain-move-speed-reader.mjs";

export function createMoveSpeed309Reader(decoderBytes, replay, options) {
  return createMoveSpeed309ReaderFromCodecs(
    createExactTerrainByteCodecs(decoderBytes, replay, options),
  );
}

export async function loadMoveSpeed309Reader(decoderPath, replay, options) {
  return createMoveSpeed309Reader(await readFile(decoderPath), replay, options);
}
