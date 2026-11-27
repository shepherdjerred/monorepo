import { readFile } from "node:fs/promises";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";

export function createWaypointReader(decoderBytes, replay, options) {
  return createWaypointReaderFromCodecs(
    createExactTerrainByteCodecs(decoderBytes, replay, options),
  );
}

export async function loadWaypointReader(decoderPath, replay, options) {
  return createWaypointReader(await readFile(decoderPath), replay, options);
}
