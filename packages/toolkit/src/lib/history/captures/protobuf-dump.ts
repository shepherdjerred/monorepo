import { readVarint } from "#lib/history/sources/antigravity-protobuf.ts";

/**
 * A schema-less field dump of a protobuf body (Cursor's Connect RPC, or any
 * other binary request), for display only: without a schema, a
 * length-delimited field may be a string, bytes, or a nested message, so each
 * is shown as the most plausible of the three.
 */

export type ProtoDumpField = {
  /** Dotted field numbers from the outermost message, such as `1.3.2`. */
  readonly path: string;
  readonly wire: "varint" | "fixed64" | "fixed32" | "string" | "bytes";
  /** Decimal for numbers, text for strings, hex (truncated) for bytes. */
  readonly value: string;
};

const MAX_FIELDS = 2000;
const MAX_DEPTH = 8;
const MAX_HEX_BYTES = 64;

/** Tab, newline, and carriage return are the only control codes text uses. */
const TEXT_CONTROLS = new Set([0x09, 0x0a, 0x0d]);
const REPLACEMENT_CHARACTER = 0xff_fd;

/** Text a person would read: no replacement or other control characters. */
function printable(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === REPLACEMENT_CHARACTER) return false;
    if (code < 0x20 && !TEXT_CONTROLS.has(code)) return false;
  }
  return true;
}

function hex(bytes: Uint8Array): string {
  const shown = Buffer.from(bytes.subarray(0, MAX_HEX_BYTES)).toString("hex");
  return bytes.length > MAX_HEX_BYTES
    ? `${shown}… (${String(bytes.length)} bytes)`
    : shown;
}

type Field =
  | { number: number; wire: "varint" | "fixed64" | "fixed32"; value: string }
  | { number: number; wire: "bytes"; value: Uint8Array };

/** One field at `offset`, and the offset after it; null if malformed. */
function readField(
  bytes: Uint8Array,
  start: number,
): { field: Field; next: number } | null {
  const [tag, offset] = readVarint(bytes, start);
  const number = Math.floor(tag / 8);
  if (number === 0) return null;
  switch (tag % 8) {
    case 0: {
      const [value, next] = readVarint(bytes, offset);
      return { field: { number, wire: "varint", value: String(value) }, next };
    }
    case 1: {
      if (offset + 8 > bytes.length) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
      const value = view.getBigUint64(0, true).toString();
      return { field: { number, wire: "fixed64", value }, next: offset + 8 };
    }
    case 5: {
      if (offset + 4 > bytes.length) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
      const value = String(view.getUint32(0, true));
      return { field: { number, wire: "fixed32", value }, next: offset + 4 };
    }
    case 2: {
      const [length, next] = readVarint(bytes, offset);
      if (next + length > bytes.length) return null;
      const value = bytes.subarray(next, next + length);
      return { field: { number, wire: "bytes", value }, next: next + length };
    }
    default:
      return null;
  }
}

function decode(bytes: Uint8Array): Field[] | null {
  const fields: Field[] = [];
  let offset = 0;
  try {
    while (offset < bytes.length) {
      const read = readField(bytes, offset);
      if (read === null) return null;
      fields.push(read.field);
      offset = read.next;
    }
  } catch {
    // A truncated varint: not protobuf.
    return null;
  }
  return fields;
}

function walk(
  bytes: Uint8Array,
  prefix: string,
  depth: number,
  out: ProtoDumpField[],
): void {
  const fields = decode(bytes) ?? [];
  for (const field of fields) {
    if (out.length >= MAX_FIELDS) return;
    const path =
      prefix === ""
        ? String(field.number)
        : `${prefix}.${String(field.number)}`;
    if (field.wire !== "bytes") {
      out.push({ path, wire: field.wire, value: field.value });
      continue;
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(field.value);
    if (field.value.length > 0 && printable(text)) {
      out.push({ path, wire: "string", value: text });
      continue;
    }
    const nested = depth < MAX_DEPTH ? decode(field.value) : null;
    if (nested !== null && nested.length > 0) {
      walk(field.value, path, depth + 1, out);
      continue;
    }
    out.push({ path, wire: "bytes", value: hex(field.value) });
  }
}

/**
 * Connect and gRPC-web stream bodies frame each message as one flag byte and
 * a four-byte big-endian length; returns the frames, or null if `bytes` is
 * not exactly a sequence of them.
 */
function connectFrames(bytes: Uint8Array): Uint8Array[] | null {
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 5 > bytes.length) return null;
    const flags = bytes[offset] ?? 0xff;
    if ((flags & 0xfc) !== 0) return null;
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 1,
      4,
    ).getUint32(0);
    if (offset + 5 + length > bytes.length) return null;
    frames.push(bytes.subarray(offset + 5, offset + 5 + length));
    offset += 5 + length;
  }
  return frames.length > 0 ? frames : null;
}

/** Fields of a protobuf body, or null when it does not decode as one. */
export function dumpProtobuf(bytes: Uint8Array): ProtoDumpField[] | null {
  const frames = connectFrames(bytes);
  const out: ProtoDumpField[] = [];
  if (frames !== null) {
    frames.forEach((frame, index) => {
      walk(frame, `frame${String(index)}`, 0, out);
    });
    return out;
  }
  if (decode(bytes) === null) return null;
  walk(bytes, "", 0, out);
  return out;
}
