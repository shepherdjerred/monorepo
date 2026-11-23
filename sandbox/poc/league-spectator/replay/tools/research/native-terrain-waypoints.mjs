import { readFile } from "node:fs/promises";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";

export function createWaypointReader(decoderBytes, replay) {
  return createWaypointReaderFromCodecs(
    createExactTerrainByteCodecs(decoderBytes, replay),
  );
}

export async function loadWaypointReader(decoderPath, replay) {
  return createWaypointReader(await readFile(decoderPath), replay);
}
