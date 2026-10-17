import { createHash } from "node:crypto";
import { IntegrationError } from "./http.ts";

/** Hash the original bencoded info bytes; re-encoding changes torrent identity. */
export function torrentInfoHashes(bytes: Uint8Array): {
  v1: string | null;
  v2: string | null;
} {
  if (bytes.length > 16 * 1024 * 1024 || bytes[0] !== 100)
    throw invalidTorrent();
  let cursor = 1;
  let info: Uint8Array | undefined;
  const keys = new Set<string>();
  while (bytes[cursor] !== 101) {
    const key = readString(bytes, cursor);
    const name = new TextDecoder().decode(key.value);
    if (keys.has(name)) throw invalidTorrent();
    keys.add(name);
    cursor = key.end;
    const end = skipValue(bytes, cursor, 0);
    if (name === "info") {
      if (bytes[cursor] !== 100) throw invalidTorrent();
      info = bytes.subarray(cursor, end);
    }
    cursor = end;
  }
  if (info === undefined || cursor + 1 !== bytes.length) throw invalidTorrent();
  const versions = infoVersions(info);
  return {
    v1: versions.v1 ? createHash("sha1").update(info).digest("hex") : null,
    v2: versions.v2 ? createHash("sha256").update(info).digest("hex") : null,
  };
}

function infoVersions(info: Uint8Array): { v1: boolean; v2: boolean } {
  const fields = dictionaryEntries(info);
  const name = fields.get("name");
  const pieceLength = fields.get("piece length");
  if (
    name === undefined ||
    pieceLength === undefined ||
    readString(name, 0).value.length === 0 ||
    integer(pieceLength) <= 0n
  )
    throw invalidTorrent();
  const pieces = fields.get("pieces");
  const version = fields.get("meta version");
  const tree = fields.get("file tree");
  const v2 = version !== undefined;
  if (v2 && (integer(version) !== 2n || tree?.[0] !== 100))
    throw invalidTorrent();
  if (pieces !== undefined) validateV1(fields, pieces);
  if (pieces === undefined && !v2) throw invalidTorrent();
  return { v1: pieces !== undefined, v2 };
}

function dictionaryEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes[0] !== 100) throw invalidTorrent();
  const fields = new Map<string, Uint8Array>();
  let cursor = 1;
  while (bytes[cursor] !== 101) {
    const key = readString(bytes, cursor);
    const end = skipValue(bytes, key.end, 0);
    fields.set(
      new TextDecoder().decode(key.value),
      bytes.subarray(key.end, end),
    );
    cursor = end;
  }
  return fields;
}

function integer(bytes: Uint8Array): bigint {
  const value = new TextDecoder().decode(bytes);
  if (!/^i(?:0|[1-9]\d*)e$/u.test(value)) throw invalidTorrent();
  return BigInt(value.slice(1, -1));
}

function validateV1(fields: Map<string, Uint8Array>, pieces: Uint8Array): void {
  const hashes = readString(pieces, 0).value;
  if (hashes.length % 20 !== 0) throw invalidTorrent();
  const length = fields.get("length");
  const files = fields.get("files");
  if ((length === undefined) === (files === undefined)) throw invalidTorrent();
  let total = length === undefined ? 0n : integer(length);
  if (files !== undefined) {
    if (files[0] !== 108 || files[1] === 101) throw invalidTorrent();
    let cursor = 1;
    while (files[cursor] !== 101) {
      const end = skipValue(files, cursor, 0);
      const file = dictionaryEntries(files.subarray(cursor, end));
      const fileLength = file.get("length");
      const path = file.get("path");
      if (fileLength === undefined || path?.[0] !== 108 || path[1] === 101)
        throw invalidTorrent();
      total += integer(fileLength);
      cursor = end;
    }
  }
  const pieceLength = fields.get("piece length");
  if (pieceLength === undefined) throw invalidTorrent();
  const pieceBytes = integer(pieceLength);
  if (BigInt(hashes.length / 20) !== (total + pieceBytes - 1n) / pieceBytes)
    throw invalidTorrent();
}

function invalidTorrent(): IntegrationError {
  return new IntegrationError("torrent", "invalid-response");
}

function readString(
  bytes: Uint8Array,
  offset: number,
): { value: Uint8Array; end: number } {
  const colon = bytes.indexOf(58, offset);
  if (colon === -1 || colon - offset > 9) throw invalidTorrent();
  const encoded = new TextDecoder().decode(bytes.subarray(offset, colon));
  if (!/^(?:0|[1-9]\d*)$/u.test(encoded)) throw invalidTorrent();
  const end = colon + 1 + Number(encoded);
  if (end > bytes.length) throw invalidTorrent();
  return { value: bytes.subarray(colon + 1, end), end };
}

function skipValue(bytes: Uint8Array, offset: number, depth: number): number {
  if (depth > 64 || offset >= bytes.length) throw invalidTorrent();
  const marker = bytes[offset];
  if (marker === 105) {
    const end = bytes.indexOf(101, offset + 1);
    if (end === -1 || end - offset > 30) throw invalidTorrent();
    const number = new TextDecoder().decode(bytes.subarray(offset + 1, end));
    if (!/^(?:0|-?[1-9]\d*)$/u.test(number)) throw invalidTorrent();
    return end + 1;
  }
  if (marker !== 100 && marker !== 108) return readString(bytes, offset).end;
  let cursor = offset + 1;
  const keys = new Set<string>();
  while (bytes[cursor] !== 101) {
    if (marker === 100) {
      const key = readString(bytes, cursor);
      const encoded = Buffer.from(key.value).toString("hex");
      if (keys.has(encoded)) throw invalidTorrent();
      keys.add(encoded);
      cursor = key.end;
    }
    cursor = skipValue(bytes, cursor, depth + 1);
  }
  return cursor + 1;
}
