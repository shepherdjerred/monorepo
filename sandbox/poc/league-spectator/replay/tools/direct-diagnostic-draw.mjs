import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";

// Diagnostic export only. Mesh packets retain the worker's 176-byte records;
// immutable SCB geometry comes from the report's compiled resource metadata.
export function directDiagnosticDraw(draw) {
  let geometry;
  if (draw.primitive === "static-mesh") {
    if (
      !Number.isInteger(draw.particleCount) ||
      draw.particleCount < 1 ||
      draw.particleCount > 65535 ||
      !(draw.meshRecords instanceof Uint8Array) ||
      draw.meshRecords.length !== draw.particleCount * 176 ||
      !(draw.indices instanceof Uint16Array) ||
      draw.indices.length !== 0 ||
      ["positions", "colors", "uv", "particleUV", "multUV", "vertexBytes"].some(
        (k) => Object.hasOwn(draw, k),
      )
    )
      throw Error("Malformed diagnostic static mesh record packet");
    geometry = {
      meshRecordsHex: Buffer.from(draw.meshRecords).toString("hex"),
    };
  } else
    geometry = Object.fromEntries(
      Object.entries(directGeometryBuffers(draw)).map(([key, value]) => [
        `${key}Hex`,
        Buffer.from(value).toString("hex"),
      ]),
    );
  return {
    ...draw,
    geometry,
    meshRecords: undefined,
    positions: draw.positions ? [...draw.positions] : undefined,
    colors: draw.colors ? [...draw.colors] : undefined,
    uv: draw.uv ? [...draw.uv] : undefined,
    particleUV: draw.particleUV ? [...draw.particleUV] : undefined,
    multUV: draw.multUV ? [...draw.multUV] : undefined,
    vertexBytes: draw.vertexBytes ? [...draw.vertexBytes] : undefined,
    indices: [...draw.indices],
  };
}
