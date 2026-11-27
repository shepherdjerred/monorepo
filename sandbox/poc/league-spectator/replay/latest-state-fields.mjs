// Shared wire grammar recovered from original reader 1db4e0. The caller must
// first establish the entity class and supply its exact registered schema.
export function decodeRegisteredState(record, meta) {
  const groups = [],
    values = {},
    consumerBits = {};
  for (const group of record.groups) {
    const schema = meta.groups[group.group];
    if (!schema || (schema.count < 32 && group.mask >>> schema.count))
      throw Error("Unregistered replication field");
    if (!/^(?:[a-f0-9]{2})*$/.test(group.dataHex))
      throw Error("Invalid replication field bytes");
    const data = Uint8Array.from(group.dataHex.match(/../g) ?? [], (v) =>
      parseInt(v, 16),
    );
    const decoded = decodeRegisteredStateGroup(
      group.group,
      group.mask,
      data,
      meta,
    );
    groups.push(decoded.group);
    Object.assign(values, decoded.values);
    Object.assign(consumerBits, decoded.consumerBits);
  }
  return { groups, values, consumerBits };
}

const floatBits = new DataView(new ArrayBuffer(4));

/** Parse one registered group directly from the packet's byte view. */
export function decodeRegisteredStateGroup(group, mask, data, meta) {
  const schema = meta.groups[group];
  if (!schema || (schema.count < 32 && mask >>> schema.count))
    throw Error("Unregistered replication field");
  if (!(data instanceof Uint8Array))
    throw Error("Invalid replication field bytes");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fieldBits = {},
    values = {},
    consumerBits = {};
  let cursor = 0;
  const requireBytes = (n) => {
    if (cursor + n > data.length) throw Error("Truncated state field");
  };
  for (let bit = 0; bit < schema.count; bit++) {
    if (!((mask >>> bit) & 1)) continue;
    requireBytes(1);
    let bits = 0;
    if ((schema.floatMask >>> bit) & 1) {
      if (data[cursor] === 255) cursor++;
      else {
        if (data[cursor] === 254) cursor++;
        requireBytes(4);
        bits = view.getUint32(cursor, true);
        cursor += 4;
      }
    } else {
      // Native varuint stores low 32 bits and consumes up to eight bytes.
      for (let i = 0; i < 8; i++) {
        requireBytes(1);
        const b = data[cursor++];
        if (i < 5) bits = (bits | ((i === 4 ? b : b & 127) << (i * 7))) >>> 0;
        if (i === 7 || b < 128) break;
      }
    }
    fieldBits[bit] = bits;
  }
  if (cursor !== data.length)
    throw Error("State group has unexpected trailing bytes");
  for (const [name, binding] of Object.entries(meta.fields)) {
    if (binding.group !== group || !Object.hasOwn(fieldBits, binding.index))
      continue;
    const bits = fieldBits[binding.index];
    consumerBits[name] = bits;
    if (binding.type === "float") {
      floatBits.setUint32(0, bits, true);
      values[name] = floatBits.getFloat32(0, true);
      if (!Number.isFinite(values[name]))
        throw Error(`Nonfinite observed ${name}`);
    } else if (binding.type === "uint32") values[name] = bits;
    else throw Error("Unknown registered field type");
  }
  return {
    group: { group, mask, consumed: cursor, fieldBits },
    values,
    consumerBits,
  };
}
