import { readFile } from "node:fs/promises";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { createMoveSpeed309ReaderFromCodecs } from "./native-terrain-move-speed-reader.mjs";

export function createMoveSpeed309Reader(decoderBytes, replay) {
  return createMoveSpeed309ReaderFromCodecs(
    createExactTerrainByteCodecs(decoderBytes, replay),
  );
}

export async function loadMoveSpeed309Reader(decoderPath, replay) {
  return createMoveSpeed309Reader(await readFile(decoderPath), replay);
}
