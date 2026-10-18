import { DeliveryError } from "#domain/error.ts";

export const MAX_FORUM_BUNDLE_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
export type ZipEntry = {
  size: number;
  crc: number;
  start: number;
  end: number;
};
type Header = {
  flags: number;
  compression: number;
  compressed: number;
  size: number;
  length: number;
  local: number;
  checksum: number;
};
export function invalidZip(): never {
  throw new DeliveryError(
    "INVALID",
    "Licensed bundle has unsafe, unsupported or corrupt ZIP entries",
  );
}

function endRecord(bytes: Uint8Array, view: DataView) {
  const end = bytes.length - 22;
  if (end < 0 || bytes.length > MAX_FORUM_BUNDLE_BYTES) invalidZip();
  if (
    view.getUint32(end, true) !== 0x06_05_4b_50 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 20, true) !== 0
  )
    invalidZip();
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (
    count === 0 ||
    count > 50_000 ||
    view.getUint16(end + 8, true) !== count ||
    offset + view.getUint32(end + 12, true) !== end
  )
    invalidZip();
  return { end, count, offset };
}

function header(view: DataView, cursor: number, end: number): Header {
  if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02_01_4b_50)
    invalidZip();
  const result = {
    flags: view.getUint16(cursor + 8, true),
    compression: view.getUint16(cursor + 10, true),
    compressed: view.getUint32(cursor + 20, true),
    size: view.getUint32(cursor + 24, true),
    length: view.getUint16(cursor + 28, true),
    local: view.getUint32(cursor + 42, true),
    checksum: view.getUint32(cursor + 16, true),
  };
  const attributes = view.getUint32(cursor + 38, true) >>> 16;
  if (
    ![0, 0x8_00].includes(result.flags) ||
    ![0, 8].includes(result.compression) ||
    result.size > MAX_FILE_BYTES ||
    cursor + 46 + result.length > end
  )
    invalidZip();
  if (
    view.getUint16(cursor + 30, true) !== 0 ||
    view.getUint16(cursor + 32, true) !== 0 ||
    view.getUint16(cursor + 34, true) !== 0 ||
    ![0, 0o10_0000].includes(attributes & 0o17_0000)
  )
    invalidZip();
  return result;
}

function entryName(bytes: Uint8Array) {
  const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    segments = name.split("/");
  if (name.length === 0 || name.includes("\\") || name.includes(":"))
    invalidZip();
  if (
    segments.some((segment) => ["", ".", ".."].includes(segment)) ||
    /\p{Cc}/u.test(name)
  )
    invalidZip();
  return name;
}

function localEntry(
  ...args: [
    bytes: Uint8Array,
    view: DataView,
    record: Header,
    name: Uint8Array,
    offset: number,
  ]
): ZipEntry {
  const [bytes, view, record, name, offset] = args;
  const { local } = record;
  if (local + 30 > offset || view.getUint32(local, true) !== 0x04_03_4b_50)
    invalidZip();
  const length = view.getUint16(local + 26, true),
    extra = view.getUint16(local + 28, true),
    start = local + 30 + length + extra;
  if (
    extra !== 0 ||
    length !== record.length ||
    start + record.compressed > offset
  )
    invalidZip();
  if (
    view.getUint16(local + 6, true) !== record.flags ||
    view.getUint16(local + 8, true) !== record.compression ||
    view.getUint32(local + 14, true) !== record.checksum ||
    view.getUint32(local + 18, true) !== record.compressed ||
    view.getUint32(local + 22, true) !== record.size
  )
    invalidZip();
  if (!Buffer.from(bytes.subarray(local + 30, start)).equals(name))
    invalidZip();
  return {
    size: record.size,
    crc: record.checksum,
    start: local,
    end: start + record.compressed,
  };
}

/** Canonical seekable ZIP from the existing Python producer. No extraction; PKWARE APPNOTE 4.3.12/4.3.16. */
export function zipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      { end, count, offset } = endRecord(bytes, view);
    const entries = new Map<string, ZipEntry>();
    let cursor = offset,
      expanded = 0;
    for (let index = 0; index < count; index++) {
      const record = header(view, cursor, end),
        nameBytes = bytes.subarray(cursor + 46, cursor + 46 + record.length),
        name = entryName(nameBytes);
      if (entries.has(name)) invalidZip();
      expanded += record.size;
      if (expanded > MAX_EXPANDED_BYTES) invalidZip();
      entries.set(name, localEntry(bytes, view, record, nameBytes, offset));
      cursor += 46 + record.length;
    }
    let boundary = 0;
    for (const range of [...entries.values()].sort(
      (a, b) => a.start - b.start,
    )) {
      if (range.start !== boundary) invalidZip();
      boundary = range.end;
    }
    if (cursor !== end || boundary !== offset) invalidZip();
    return entries;
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    return invalidZip();
  }
}
