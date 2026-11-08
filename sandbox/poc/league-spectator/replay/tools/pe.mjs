// Static PE metadata only; does not execute or initialize the game binary.
export function inspectExecutable(bytes) {
  if (bytes.toString("ascii", 0, 2) !== "MZ")
    throw Error("Invalid executable DOS header");
  const pe = bytes.readUInt32LE(0x3c);
  if (
    pe + 24 > bytes.length ||
    bytes.toString("ascii", pe, pe + 4) !== "PE\0\0"
  )
    throw Error("Invalid executable PE header");
  const optional = pe + 24;
  const optionalSize = bytes.readUInt16LE(pe + 20);
  if (
    optionalSize < 64 ||
    optional + optionalSize > bytes.length ||
    bytes.readUInt16LE(optional) !== 0x20b
  )
    throw Error("Expected PE32+ executable");
  const count = bytes.readUInt16LE(pe + 6);
  const sections = [];
  for (let i = 0; i < count; i++) {
    const at = optional + optionalSize + i * 40;
    if (at + 40 > bytes.length) throw Error("Truncated PE section table");
    const name = bytes.toString("ascii", at, at + 8).replace(/\0+$/, "");
    const size = bytes.readUInt32LE(at + 16),
      offset = bytes.readUInt32LE(at + 20);
    if (offset + size > bytes.length) throw Error(`Invalid PE section ${name}`);
    const data = bytes.subarray(offset, offset + size),
      histogram = new Uint32Array(256);
    for (const value of data) histogram[value]++;
    let entropy = 0;
    for (const n of histogram)
      if (n) {
        const p = n / data.length;
        entropy -= p * Math.log2(p);
      }
    sections.push({
      name,
      rva: bytes.readUInt32LE(at + 12),
      virtualSize: bytes.readUInt32LE(at + 8),
      offset,
      size,
      entropy,
    });
  }
  const resource = sections.find((s) => s.name === ".rsrc");
  const versions = new Set();
  if (resource) {
    const data = bytes.subarray(
      resource.offset,
      resource.offset + resource.size,
    );
    for (
      let at = 0;
      (at = data.indexOf(Buffer.from("bd04effe00000100", "hex"), at)) !== -1;
      at++
    ) {
      if (at + 52 > data.length) continue;
      const hi = data.readUInt32LE(at + 8),
        lo = data.readUInt32LE(at + 12);
      versions.add([hi >>> 16, hi & 65535, lo >>> 16, lo & 65535].join("."));
    }
  }
  if (versions.size !== 1)
    throw Error("Executable must have one unambiguous fixed file version");
  return {
    version: [...versions][0],
    machine: bytes.readUInt16LE(pe + 4),
    imageBase: `0x${bytes.readBigUInt64LE(optional + 24).toString(16)}`,
    sizeOfImage: bytes.readUInt32LE(optional + 56),
    sections,
  };
}
