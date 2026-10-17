import { createHash } from "node:crypto";
import { IntegrationError } from "./http.ts";

/** Hash the original bencoded info bytes; re-encoding changes torrent identity. */
export function torrentInfoHashes(bytes: Uint8Array): {
  v1: string;
  v2: string;
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
  return {
    v1: createHash("sha1").update(info).digest("hex"),
    v2: createHash("sha256").update(info).digest("hex"),
  };
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
