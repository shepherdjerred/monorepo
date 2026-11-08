// Plain movement-vector grammar. Coordinates remain relative until the map's
// recorded/asset-derived origin is established. This does not decrypt packets.
export function readMovementRecords(bytes, { deltaMode, motionBlock = false }) {
  if (!["signed8", "unsigned8"].includes(deltaMode))
    throw Error("Explicit movement delta interpretation required");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = [];
  let cursor = 0;
  const need = (size) => {
    if (cursor + size > bytes.length) throw Error("Truncated movement record");
  };
  while (cursor < bytes.length) {
    need(10);
    const recordType = view.getUint16(cursor, true),
      entityId = view.getUint32(cursor + 2, true),
      speed = view.getFloat32(cursor + 6, true);
    cursor += 10;
    if (!Number.isFinite(speed) || speed < 0 || speed > 5000)
      throw Error("Invalid movement speed");
    let extraByte = null;
    if (recordType & 1) {
      need(1);
      extraByte = bytes[cursor++];
    }
    let parameterId = null,
      auxiliaryFloats = null,
      motion = null;
    if (recordType & 0x400) {
      need(4);
      parameterId = view.getUint32(cursor, true);
      cursor += 4;
    }
    if (recordType & 0x800) {
      need(8);
      auxiliaryFloats = [0, 4].map((at) => view.getFloat32(cursor + at, true));
      if (!auxiliaryFloats.every(Number.isFinite))
        throw Error("Non-finite movement auxiliary fields");
      cursor += 8;
    }
    if (motionBlock) {
      need(56);
      motion = {
        speed: view.getFloat32(cursor, true),
        scalar4: view.getFloat32(cursor + 4, true),
        scalar8: view.getFloat32(cursor + 8, true),
        scalar12: view.getFloat32(cursor + 12, true),
        sourcePosition: [16, 20].map((at) =>
          view.getFloat32(cursor + at, true),
        ),
        rawBytes: [...bytes.subarray(cursor, cursor + 56)],
        referenceVerified: false,
      };
      if (
        ![
          motion.speed,
          motion.scalar4,
          motion.scalar8,
          motion.scalar12,
          ...motion.sourcePosition,
        ].every(Number.isFinite) ||
        motion.speed < 0
      )
        throw Error("Invalid movement motion block");
      cursor += 56;
    }
    const count = (recordType & 255) >> 1;
    if (!count) throw Error("Movement without waypoints");
    const bitmap = cursor,
      bitmapSize = count > 1 ? ((count - 2) >> 2) + 1 : 0;
    need(bitmapSize);
    cursor += bitmapSize;
    let bit = 0,
      x = 0,
      z = 0;
    const encodedWaypoints = [];
    for (let index = 0; index < count; index++) {
      const coordinate = (previous) => {
        const delta =
          index > 0 && (bytes[bitmap + (bit >> 3)] >> (bit++ & 7)) & 1;
        need(delta ? 1 : 2);
        const value = delta
          ? (previous +
              (deltaMode === "signed8"
                ? view.getInt8(cursor)
                : bytes[cursor])) &
            65535
          : view.getUint16(cursor, true);
        cursor += delta ? 1 : 2;
        return value;
      };
      x = coordinate(x);
      z = coordinate(z);
      encodedWaypoints.push([
        x & 0x8000 ? x - 65536 : x,
        z & 0x8000 ? z - 65536 : z,
      ]);
    }
    records.push({
      entityId,
      speed,
      recordType,
      extraByte,
      parameterId,
      auxiliaryFloats,
      motion,
      encodedWaypoints,
    });
  }
  return records;
}

export function movementWorldPaths(records, origin) {
  if (
    !Array.isArray(origin) ||
    origin.length !== 2 ||
    !origin.every(Number.isFinite)
  )
    throw Error("Verified map movement origin required");
  return records.map(({ entityId, speed, encodedWaypoints }) => ({
    entityId,
    speed,
    waypoints: encodedWaypoints.map(([x, z]) => [
      x * 2 + origin[0],
      z * 2 + origin[1],
    ]),
  }));
}
