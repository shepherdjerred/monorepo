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
      ),
      view = new DataView(data.buffer),
      fieldBits = {};
    let cursor = 0;
    const requireBytes = (n) => {
      if (cursor + n > data.length) throw Error("Truncated state field");
    };
    for (let bit = 0; bit < schema.count; bit++) {
      if (!((group.mask >>> bit) & 1)) continue;
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
    groups.push({
      group: group.group,
      mask: group.mask,
      consumed: cursor,
      fieldBits,
    });
    for (const [name, binding] of Object.entries(meta.fields)) {
      if (
        binding.group !== group.group ||
        !Object.hasOwn(fieldBits, binding.index)
      )
        continue;
      const bits = fieldBits[binding.index];
      consumerBits[name] = bits;
      if (binding.type === "float") {
        const v = new DataView(new ArrayBuffer(4));
        v.setUint32(0, bits, true);
        values[name] = v.getFloat32(0, true);
        if (!Number.isFinite(values[name]))
          throw Error(`Nonfinite observed ${name}`);
      } else if (binding.type === "uint32") values[name] = bits;
      else throw Error("Unknown registered field type");
    }
  }
  return { groups, values, consumerBits };
}
