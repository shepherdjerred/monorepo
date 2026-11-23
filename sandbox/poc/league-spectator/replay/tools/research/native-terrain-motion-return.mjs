// Exact 16.23.840.6595 opcode 1098 body reader. The header selector at
// 0x105d3ef controls the preceding scalar. The 0x10f06f0 vector reader
// decodes two big-endian float32 lanes in Z, X order.
export function readNativeTerrainReturnPosition(payload) {
  if (!(payload instanceof Uint8Array) || payload.length === 0)
    throw Error("Missing champion return packet body");
  const selector = (payload[0] >>> 1) & 7;
  const scalarBytes = [0, 0, 0, 4, 0, 4, 4, 4][selector];
  const vectorOffset = 1 + scalarBytes;
  const omitted = Boolean(payload[0] & 1);
  if (payload.length !== vectorOffset + (omitted ? 0 : 8))
    throw Error("Invalid champion return packet width");
  if (omitted) return null;

  const decoded = new DataView(new ArrayBuffer(8));
  for (let laneByte = 0; laneByte < 8; laneByte++) {
    const byte = ((payload[vectorOffset + laneByte] ^ 0xc7) + 0xe1) & 0xff;
    const swapped = ((byte >>> 1) & 0x55) | ((byte << 1) & 0xaa);
    decoded.setUint8(laneByte, (swapped ^ 0x38) + 0x10);
  }
  const x = decoded.getFloat32(4);
  const z = decoded.getFloat32(0);
  if (!Number.isFinite(x) || !Number.isFinite(z))
    throw Error("Invalid champion return position coordinates");
  return { x, z };
}
