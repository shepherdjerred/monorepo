import { decodeRegisteredStateGroup } from "../../latest-state-fields.mjs";

// Opcode 309 body reader 0x1072260 and vector reader 0x11190b0.
const defaultRecordCounts = [255, null, null, 1, null, 2, 0, null];
const wireGroupSelectors = [1, 2, 4, 8, 16, 32, 64];

// The original group 32 descriptor at 0x25078a8 has 32 fields.
// Bit 24 registers the float at unit+0x17b0, read by stat refresh 0x67ca0.
const moveSpeedSchema = {
  groups: { 32: { count: 32, floatMask: 0x0f99fbff } },
  fields: { moveSpeed: { group: 32, index: 24, type: "float" } },
};
// Compact champion registration and consumer fields verified by the original
// health and resource readers on the current replay build.
const championStatsSchema = {
  groups: {
    1: { count: 28, floatMask: 0x0fffff07 },
    ...moveSpeedSchema.groups,
  },
  fields: {
    ...moveSpeedSchema.fields,
    health: { group: 32, index: 0, type: "float" },
    healthMax: { group: 32, index: 1, type: "float" },
    resource: { group: 32, index: 15, type: "float" },
    resourceMax: { group: 32, index: 16, type: "float" },
    gold: { group: 1, index: 0, type: "float" },
  },
};
// Current native registration and getters corroborate group 32 bits 11 and 28.
const experienceFields = {
  experience: { group: 32, index: 11, type: "float" },
  level: { group: 32, index: 28, type: "uint32" },
};
const experienceOnlySchema = {
  ...moveSpeedSchema,
  fields: { ...moveSpeedSchema.fields, ...experienceFields },
};
const statsWithExperienceSchema = {
  ...championStatsSchema,
  fields: { ...championStatsSchema.fields, ...experienceFields },
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

function visitReplicationGroups(vector, count, visit) {
  const view = new DataView(vector.buffer);
  let cursor = 0;
  let recordIndex = 0;
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
      visit(entityId, recordIndex, group, mask, start, cursor);
    }
    recordIndex++;
  }
  if (recordIndex !== count)
    throw Error("Opcode 309 replication record count mismatch");
}

function readChampionReplication(
  vector,
  count,
  verifiedChampionIds,
  { includeChampionStats, includeChampionExperience },
) {
  const updates = [];
  const statsWrites = includeChampionStats ? [] : null;
  const experienceWrites = includeChampionExperience ? [] : null;
  const schema = includeChampionExperience
    ? includeChampionStats
      ? statsWithExperienceSchema
      : experienceOnlySchema
    : includeChampionStats
      ? championStatsSchema
      : moveSpeedSchema;
  let championGroups = 0;
  visitReplicationGroups(
    vector,
    count,
    (entityId, recordIndex, group, mask, start, end) => {
      if (
        !verifiedChampionIds.has(entityId) ||
        (group !== 32 && !(statsWrites && group === 1 && mask & 1))
      )
        return;
      if (group === 32) championGroups++;
      const { values } = decodeRegisteredStateGroup(
        group,
        mask,
        vector.subarray(start, end),
        schema,
      );
      if (Object.hasOwn(values, "moveSpeed"))
        updates.push({ entityId, recordIndex, moveSpeed: values.moveSpeed });
      if (statsWrites || experienceWrites) {
        const { moveSpeed, experience, level, ...stats } = values;
        if (
          experienceWrites &&
          (experience !== undefined || level !== undefined)
        ) {
          experienceWrites.push({ entityId, experience, level });
        }
        if (statsWrites && Object.keys(stats).length > 0)
          statsWrites.push({ entityId, ...stats });
      }
    },
  );
  return {
    recordCount: count,
    championGroups,
    updates,
    ...(statsWrites && { statsWrites }),
    ...(experienceWrites && { experienceWrites }),
  };
}

/** Expose original Group 8 field bytes for independently registered prefixes. */
export function createGroup8Prefix309ReaderFromCodecs({
  decodeReplicationVectorByte,
  decodeReplicationTailByte,
}) {
  return (payload, verifiedEntityIds) => {
    if (verifiedEntityIds !== undefined && !(verifiedEntityIds instanceof Set))
      throw Error("A verified entity ID set is required when filtering");
    const { vector, count } = readReplicationVector(
      payload,
      decodeReplicationVectorByte,
      decodeReplicationTailByte,
    );
    const rows = [];
    visitReplicationGroups(
      vector,
      count,
      (entityId, recordIndex, group, mask, start, end) => {
        if (
          group === 8 &&
          (verifiedEntityIds === undefined || verifiedEntityIds.has(entityId))
        )
          rows.push({
            entityId,
            recordIndex,
            mask,
            bytes: vector.subarray(start, end),
          });
      },
    );
    return { recordCount: count, rows };
  };
}

/** Decode recorded MoveSpeed writes for independently bound champion IDs. */
export function createMoveSpeed309ReaderFromCodecs({
  decodeReplicationVectorByte,
  decodeReplicationTailByte,
}) {
  return (payload, verifiedChampionIds, options = {}) => {
    if (!(verifiedChampionIds instanceof Set))
      throw Error("A verified champion ID set is required");
    const { vector, count } = readReplicationVector(
      payload,
      decodeReplicationVectorByte,
      decodeReplicationTailByte,
    );
    return readChampionReplication(vector, count, verifiedChampionIds, options);
  };
}
