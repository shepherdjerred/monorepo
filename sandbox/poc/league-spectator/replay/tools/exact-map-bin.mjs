// PROP v3 metadata for the established Map11 and item sources.
// The retained Toolkit property readers establish section sizes; CDTB's 16.21
// reader identifies 64-bit Hash fields in the original class 0xff9d3409.
export const MAP_BIN_READER_SOURCE_URL =
  "https://raw.githubusercontent.com/CommunityDragon/CDTB/aacc5309439737392a3cbe1d09c06625f667ca62/cdtb/binfile.py";
export const MAP_BIN_READER_SOURCE_SHA256 =
  "92ee01c7f8670ed191f66696f115099acd36e29f3a8663f216bcba2b9296419c";
const names = new Map([
  [0, "None"],
  [1, "Bool"],
  [2, "I8"],
  [3, "U8"],
  [4, "I16"],
  [5, "U16"],
  [6, "I32"],
  [7, "U32"],
  [8, "I64"],
  [9, "U64"],
  [10, "F32"],
  [11, "Vector2"],
  [12, "Vector3"],
  [13, "Vector4"],
  [14, "Matrix44"],
  [15, "Color"],
  [16, "String"],
  [17, "Hash"],
  [18, "WadChunkLink"],
  [0x80, "Container"],
  [0x81, "UnorderedContainer"],
  [0x82, "Struct"],
  [0x83, "Embedded"],
  [0x84, "ObjectLink"],
  [0x85, "Optional"],
  [0x86, "Map"],
  [0x87, "BitBool"],
]);
const hash64Class = 0xff9d3409;
const hex = (value) => value.toString(16).padStart(8, "0");
const exactItemDefinitionsSha256 =
  "838c2828b0f8ae9e2380611691553ba67c163c7810bc0898a73807e1dca4d33c";
const exactMap11DefinitionSha256 =
  "338a12c915c8fc2c38a7d5ac9e4ae1e15a1a4ccd0115f2e4f6050e15497ca0f6";
const exactGlobalsSha256 =
  "4a900161dc0f4b531e06e4ad0f241dae22ffc9366c9bc5069271f8f464ced763";

export function readExactMapBin(
  bytes,
  build = "16.21.829.8620",
  { captureFieldSpans = false } = {},
) {
  if (build !== "16.21.829.8620" || !(bytes instanceof Uint8Array))
    throw Error("Exact 16.21 BIN bytes required");
  return readPropertyBin(bytes, build, captureFieldSpans);
}

export function readExactItemDefinitions(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      exactItemDefinitionsSha256
  )
    throw Error("Exact 16.23 item definitions required");
  return readPropertyBin(bytes, "16.23.840.6595", false);
}

export function readExactMap11Definition(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      exactMap11DefinitionSha256
  )
    throw Error("Exact 16.23 Map11 definition required");
  return {
    ...readPropertyBin(bytes, "16.23.840.6595", false),
    reader: "scout-exact-map11-prop-v3",
  };
}

export function readExactClassicCameraDefaults(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      exactGlobalsSha256
  )
    throw Error("Exact 16.23 Global camera configuration required");
  const { objects } = readPropertyBin(bytes, "16.23.840.6595", false);
  const profile = objects.find(({ pathHash }) => pathHash === "28f338a2");
  if (
    profile?.classHash !== "dff5a8f8" ||
    profile.fields["83fa5f0d"] !== undefined ||
    profile.fields.f10ed334 !== undefined
  )
    throw Error("Unexpected CLASSIC CameraConfig lens or distance override");
  // The exact CameraConfig and gameplay camera initializers select this
  // lens and neutral orientation. The distance is the native normalized
  // eye offset magnitude before camera movement or recentering.
  return {
    verticalFovDegrees: 40,
    nearClip: 50,
    pitchDegrees: 56,
    eyeDistance: 2306.10546875,
    farClipping: { base: 10_000, configuredDistance: 2250 },
  };
}

function readPropertyBin(bytes, build, captureFieldSpans) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let cursor = 0,
    properties = 0;
  const hash64Fields = [];
  const need = (length) => {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      cursor + length > bytes.length
    )
      throw Error(`BIN bounds at ${cursor}, length ${length}`);
  };
  const u8 = () => {
    need(1);
    return view.getUint8(cursor++);
  };
  const u16 = () => {
    need(2);
    const value = view.getUint16(cursor, true);
    cursor += 2;
    return value;
  };
  const u32 = () => {
    need(4);
    const value = view.getUint32(cursor, true);
    cursor += 4;
    return value;
  };
  const f32 = () => {
    need(4);
    const value = view.getFloat32(cursor, true);
    cursor += 4;
    if (!Number.isFinite(value)) throw Error("Non-finite BIN scalar");
    return value;
  };
  const string = () => {
    const length = u16();
    need(length);
    const value = decoder.decode(bytes.subarray(cursor, cursor + length));
    cursor += length;
    return value;
  };
  const count = () => {
    const value = u32();
    if (value > 1_000_000) throw Error("BIN count exceeds metadata bounds");
    return value;
  };
  const end = () => {
    const length = u32();
    need(length);
    return cursor + length;
  };
  const closed = (expected, label) => {
    if (cursor !== expected)
      throw Error(
        `BIN ${label} length mismatch at ${cursor}; expected ${expected}`,
      );
  };
  const readType = () => {
    const value = u8();
    if (!names.has(value))
      throw Error(`Unsupported BIN type ${value} at ${cursor - 1}`);
    return value;
  };
  function fields(length, owner, depth, spans = null) {
    const result = {};
    for (let index = 0; index < length; index++) {
      const start = cursor,
        name = u32(),
        kind = readType(),
        offset = cursor;
      if (Object.hasOwn(result, hex(name)))
        throw Error(`Duplicate BIN field ${hex(name)} at ${cursor}`);
      const wide = kind === 17 && owner === hash64Class;
      result[hex(name)] = property(kind, depth + 1, wide);
      if (spans !== null)
        spans.push({
          fieldHash: hex(name),
          offset: start,
          bytes: cursor - start,
        });
      if (wide)
        hash64Fields.push({
          ownerClass: hex(owner),
          fieldHash: hex(name),
          offset,
          bytes: 8,
        });
    }
    return result;
  }
  function property(kind, depth, wide = false) {
    if (depth > 64 || ++properties > 1_000_000)
      throw Error("BIN property nesting/count exceeds bounds");
    let value;
    const type = wide ? "Hash64" : names.get(kind);
    switch (kind) {
      case 0:
        value = [u16(), u16(), u16()];
        break;
      case 1: {
        const byte = u8();
        if (byte > 1) throw Error("Invalid BIN boolean");
        value = byte === 1;
        break;
      }
      case 2:
        need(1);
        value = view.getInt8(cursor++);
        break;
      case 3:
      case 0x87:
        value = u8();
        break;
      case 4:
        need(2);
        value = view.getInt16(cursor, true);
        cursor += 2;
        break;
      case 5:
        value = u16();
        break;
      case 6:
        need(4);
        value = view.getInt32(cursor, true);
        cursor += 4;
        break;
      case 7:
      case 0x84:
        value = u32();
        break;
      case 8:
        need(8);
        value = view.getBigInt64(cursor, true).toString();
        cursor += 8;
        break;
      case 9:
      case 18:
        need(8);
        value = view.getBigUint64(cursor, true).toString();
        cursor += 8;
        break;
      case 10:
        value = f32();
        break;
      case 11:
      case 12:
      case 13:
        value = Object.fromEntries(
          ["X", "Y", "Z", "W"].slice(0, kind - 9).map((axis) => [axis, f32()]),
        );
        break;
      case 14:
        value = Array.from({ length: 16 }, f32);
        break;
      case 15:
        value = Array.from({ length: 4 }, u8);
        break;
      case 16:
        value = string();
        break;
      case 17:
        if (wide) {
          need(8);
          value = view.getBigUint64(cursor, true).toString();
          cursor += 8;
        } else value = u32();
        break;
      case 0x80:
      case 0x81: {
        const element = readType(),
          boundary = end(),
          length = count();
        const elements = Array.from({ length }, () =>
          property(element, depth + 1),
        );
        closed(boundary, "container");
        return { type, elements };
      }
      case 0x82:
      case 0x83: {
        const owner = u32();
        if (kind === 0x82 && owner === 0)
          return { type, classHash: hex(owner), fields: {} };
        const spans = captureFieldSpans ? [] : null,
          boundary = end(),
          length = u16(),
          entries = fields(length, owner, depth, spans);
        closed(boundary, "struct");
        return {
          type,
          classHash: hex(owner),
          fields: entries,
          ...(spans === null ? {} : { fieldSpans: spans }),
        };
      }
      case 0x85: {
        const element = readType(),
          present = u8();
        if (present > 1) throw Error("Invalid BIN optional presence");
        return {
          type,
          value: present === 0 ? null : property(element, depth + 1),
        };
      }
      case 0x86: {
        const key = readType(),
          item = readType(),
          boundary = end(),
          length = count();
        const entries = Array.from({ length }, () => ({
          key: property(key, depth + 1),
          value: property(item, depth + 1),
        }));
        closed(boundary, "map");
        return { type, entries };
      }
      default:
        throw Error(`Unsupported BIN type ${kind}`);
    }
    return { type, value };
  }
  need(12);
  if (decoder.decode(bytes.subarray(0, 4)) !== "PROP")
    throw Error(
      "Only original PROP metadata is supported; patch overrides are not admitted",
    );
  cursor = 4;
  if (u32() !== 3) throw Error("Only observed PROP version 3 is admitted");
  const dependencies = Array.from({ length: count() }, string);
  const length = count();
  need(length * 4);
  const classes = Array.from({ length }, u32),
    objects = [],
    paths = new Set();
  for (const owner of classes) {
    const boundary = end(),
      path = u32(),
      length = u16();
    if (paths.has(path)) throw Error(`Duplicate BIN object ${hex(path)}`);
    paths.add(path);
    const spans = captureFieldSpans ? [] : null;
    objects.push({
      pathHash: hex(path),
      classHash: hex(owner),
      fields: fields(length, owner, 0, spans),
      ...(spans === null ? {} : { fieldSpans: spans }),
    });
    closed(boundary, "object");
  }
  closed(bytes.length, "file");
  return {
    schema: 1,
    reader:
      build === "16.21.829.8620"
        ? "scout-exact-property-bin-16.21"
        : "scout-exact-item-prop-v3",
    build,
    formatReference: MAP_BIN_READER_SOURCE_URL,
    formatReferenceSha256: MAP_BIN_READER_SOURCE_SHA256,
    sourceSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    dependencies,
    objects,
    hash64Fields,
    propertyCount: properties,
  };
}
