// Minimal protobuf decoder for Antigravity's local conversation SQLite
// databases (`gen_metadata.data`, `steps.metadata`,
// `trajectory_metadata_blob.data`). Field numbers used against this decoder
// live in antigravity.ts, transcribed from ccusage's Rust adapter
// (`rust/adapters/antigravity/src/parser.rs`), the only known-correct
// decoding of this format; there is no official schema.

export type ProtoField =
  | { readonly number: number; readonly kind: "varint"; readonly value: number }
  | {
      readonly number: number;
      readonly kind: "bytes";
      readonly value: Uint8Array;
    };

export function readVarint(
  bytes: Uint8Array,
  offset: number,
): readonly [number, number] {
  let result = 0;
  let shift = 0;
  let position = offset;
  for (;;) {
    const byte = bytes[position];
    if (byte === undefined) {
      throw new Error("Truncated protobuf varint");
    }
    position += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return [result, position];
    }
    shift += 7;
    if (shift > 63) {
      throw new Error("Protobuf varint exceeds 63 bits");
    }
  }
}

export function decodeFields(blob: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < blob.length) {
    const [tag, afterTag] = readVarint(blob, offset);
    offset = afterTag;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    switch (wireType) {
      case 0: {
        const [value, next] = readVarint(blob, offset);
        offset = next;
        fields.push({ number: fieldNumber, kind: "varint", value });
        break;
      }
      case 1: {
        offset += 8;
        break;
      }
      case 2: {
        const [length, afterLength] = readVarint(blob, offset);
        offset = afterLength;
        fields.push({
          number: fieldNumber,
          kind: "bytes",
          value: blob.subarray(offset, offset + length),
        });
        offset += length;
        break;
      }
      case 5: {
        offset += 4;
        break;
      }
      default:
        throw new Error(`Unsupported protobuf wire type ${String(wireType)}`);
    }
  }
  return fields;
}

export function fieldVarint(
  fields: readonly ProtoField[],
  number: number,
): number | undefined {
  const values = fields.flatMap((field) =>
    field.number === number && field.kind === "varint" ? [field.value] : [],
  );
  return values.length === 0 ? undefined : values.at(-1);
}

export function fieldBytesAll(
  fields: readonly ProtoField[],
  number: number,
): Uint8Array[] {
  return fields.flatMap((field) =>
    field.number === number && field.kind === "bytes" ? [field.value] : [],
  );
}

export function fieldBytes(
  fields: readonly ProtoField[],
  number: number,
): Uint8Array | undefined {
  return fieldBytesAll(fields, number)[0];
}

export function fieldText(
  fields: readonly ProtoField[],
  number: number,
): string | undefined {
  const last = fieldBytesAll(fields, number).at(-1);
  return last === undefined || last.length === 0
    ? undefined
    : new TextDecoder().decode(last);
}
