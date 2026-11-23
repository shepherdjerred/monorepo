import { decodeRegisteredState } from "../../latest-state-fields.mjs";

// Opcode 309 body reader 0x1072260 and vector reader 0x11190b0.
const defaultRecordCounts = [255, null, null, 1, null, 2, 0, null];
const wireGroupSelectors = [1, 2, 4, 8, 16, 32, 64];

// The original group 32 descriptor at 0x25078a8 has 32 fields.
// Bit 24 registers the float at unit+0x17b0, read by stat refresh 0x67ca0.
const moveSpeedSchema = {
  groups: { 32: { count: 32, floatMask: 0x0f99fbff } },
  fields: { moveSpeed: { group: 32, index: 24, type: "float" } },
};

function readReplicationVector(payload, decodeVectorByte, decodeTailByte) {
  if (!(payload instanceof Uint8Array) || payload.length < 2)
    throw Error("Truncated opcode 309 body");
  const [first, second] = payload;
  let cursor = ((first >>> 1) & 7) >= 4 ? 6 : 2;
  function readVarUint(decodeByte) {
    let value = 0;
    for (let shift = 0; shift < 35 && cursor < payload.length; shift += 7) {
      const byte = decodeByte(payload[cursor++]);
      value += (byte & 0x7f) * 2 ** shift;
      if (value > 0xffffffff) break;
      if ((byte & 0x80) === 0) return value;
    }
    throw Error("Truncated or out-of-range opcode 309 varuint");
  }
  const length = first & 1 ? 0 : readVarUint(decodeVectorByte);
  if (length > payload.length - cursor)
    throw Error("Opcode 309 replication vector exceeds packet length");
  const vector = new Uint8Array(length);
  for (let offset = 0; offset < length; offset++) {
    const index = offset >>> 1;
    vector[offset & 1 ? length - 1 - index : index] = decodeVectorByte(
      payload[cursor++],
    );
  }
  const countMode = (first >>> 7) | ((second & 3) << 1);
  let count = defaultRecordCounts[countMode];
  if (count === null) {
    if (cursor >= payload.length)
      throw Error("Truncated opcode 309 record count");
    const byte = payload[cursor++];
    count = ((byte >>> 1) | ((byte & 1) << 7)) ^ 0xc1;
  }
  if ([0, 4, 5, 6].includes((first >>> 4) & 7)) readVarUint(decodeTailByte);
  if (cursor !== payload.length)
    throw Error("Opcode 309 body has an inconsistent length");
  return { vector, count };
}

function readMoveSpeeds(vector, count, verifiedChampionIds) {
  const view = new DataView(vector.buffer);
  const updates = [];
  let cursor = 0;
  let recordIndex = 0;
  let championGroups = 0;
  while (cursor < vector.length) {
    if (cursor + 5 > vector.length)
      throw Error("Truncated opcode 309 replication record");
    const groupSelector = vector[cursor];
    const entityId = view.getUint32(cursor + 1, true);
    cursor += 5;
    if (groupSelector & 0x80)
      throw Error("Unsupported opcode 309 replication group selector");
    for (const group of wireGroupSelectors) {
      if (!(groupSelector & group)) continue;
      if (cursor + 5 > vector.length)
        throw Error("Truncated opcode 309 replication group header");
      const mask = view.getUint32(cursor, true);
      const size = vector[cursor + 4];
      const start = cursor + 5;
      cursor = start + size;
      if (cursor > vector.length)
        throw Error("Truncated opcode 309 replication group body");
      if (group !== 32 || !verifiedChampionIds.has(entityId)) continue;
      championGroups++;
      const { values } = decodeRegisteredState(
        {
          groups: [
            {
              group,
              mask,
              dataHex: Array.from(vector.subarray(start, cursor), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join(""),
            },
          ],
        },
        moveSpeedSchema,
      );
      if (Object.hasOwn(values, "moveSpeed"))
        updates.push({ entityId, recordIndex, moveSpeed: values.moveSpeed });
    }
    recordIndex++;
  }
  if (recordIndex !== count)
    throw Error("Opcode 309 replication record count mismatch");
  return { recordCount: count, championGroups, updates };
}

/** Decode recorded MoveSpeed writes for independently bound champion IDs. */
export function createMoveSpeed309ReaderFromCodecs({
  decodeReplicationVectorByte,
  decodeReplicationTailByte,
}) {
  return (payload, verifiedChampionIds) => {
    if (!(verifiedChampionIds instanceof Set))
      throw Error("A verified champion ID set is required");
    const { vector, count } = readReplicationVector(
      payload,
      decodeReplicationVectorByte,
      decodeReplicationTailByte,
    );
    return readMoveSpeeds(vector, count, verifiedChampionIds);
  };
}
