import { readMovementRecords } from "../../movement-records.mjs";

// Exact packet dispatch routes opcode 96 to the ordinary waypoint record
// consumer and opcode 1174 to its motion-block variant. Both body readers
// (0x1190880 and 0x1190ad0) use the same header selectors and vector reader.
const defaultSyncIds = [null, 0xffffffff, null, null, null, 0, 2, 1];
const defaultCounts = [null, null, 0, 0xffff, null, null, 2, 1];
const decodeVectorByte = (byte) => (byte + 0x69) & 0xff;

function readVarUint(payload, cursor, decodeByte, maximum) {
  let value = 0;
  let scale = 1;
  while (scale <= maximum && cursor < payload.length) {
    const byte = decodeByte(payload[cursor++]);
    value += (byte & 0x7f) * scale;
    if (value > maximum) break;
    if ((byte & 0x80) === 0) return { value, cursor };
    scale *= 0x80;
  }
  throw Error("Truncated or out-of-range waypoint field");
}

function readVector(payload, offset, length) {
  // Reader 0x126c990 writes decoded bytes alternately from the front and back.
  const vector = new Uint8Array(length);
  let start = 0;
  let end = length - 1;
  while (start < end) {
    vector[start++] = decodeVectorByte(payload[offset++]);
    vector[end--] = decodeVectorByte(payload[offset++]);
  }
  if (start === end) vector[start] = decodeVectorByte(payload[offset]);
  return vector;
}

/** Read observed waypoint records in their recorded relative X/Z units. */
export function createWaypointReaderFromCodecs({
  decodePositionByte,
  decodeSyncByte,
}) {
  return (opcode, payload) => {
    if (opcode !== 96 && opcode !== 1174)
      throw Error("Unsupported waypoint opcode");
    if (!(payload instanceof Uint8Array) || payload.length < 1)
      throw Error("Truncated waypoint packet body");
    const header = payload[0];
    if (header & 0x80) throw Error("Unsupported waypoint header flag");
    let cursor = 1;
    function readValue(defaultValue, decodeByte, maximum) {
      if (defaultValue !== null) return defaultValue;
      const field = readVarUint(payload, cursor, decodeByte, maximum);
      cursor = field.cursor;
      return field.value;
    }
    const syncId = readValue(
      defaultSyncIds[(header >>> 4) & 7],
      decodeSyncByte,
      0xffffffff,
    );
    const count = readValue(
      defaultCounts[(header >>> 1) & 7],
      decodePositionByte,
      0xffff,
    );
    const length =
      header & 1 ? readValue(null, decodeVectorByte, 0xffffffff) : 0;
    if (length !== payload.length - cursor)
      throw Error("Waypoint vector length disagrees with packet body");
    const records = readMovementRecords(readVector(payload, cursor, length), {
      deltaMode: "signed8",
      motionBlock: opcode === 1174,
    });
    if (records.length !== count)
      throw Error("Waypoint record count disagrees with packet header");
    return { syncId, records };
  };
}
