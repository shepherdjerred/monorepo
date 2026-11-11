import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  countByKind,
  findSecrets,
  redactBytes,
  replacementFor,
  type SecretKind,
  type SecretMatch,
} from "#lib/brim/sync/redact.ts";
import { asRecord } from "./json.ts";
import type { CaptureStore } from "./store.ts";

/**
 * Overwrites credentials in captured requests with the `brim sync` patterns:
 * in spool segments not yet ingested (in place, same length, so a proxy still
 * appending is unaffected) and in every stored blob. Ingest already redacts,
 * so this matters after a pattern is added. A redacted blob gets a new
 * content hash and every reference moves to it.
 *
 * A spool segment is JSONL, and a PEM key's armor may span lines, so it is
 * scanned one JSON string at a time: a match never crosses into another
 * value or record, which would overwrite the JSON between them.
 */

export type CaptureRedactReport = {
  readonly spoolFiles: number;
  readonly redactedSpoolFiles: number;
  readonly blobs: number;
  readonly redactedBlobs: number;
  readonly totals: Partial<Record<SecretKind, number>>;
  readonly dryRun: boolean;
};

export type Redacted<T> = { readonly value: T; readonly secrets: number };

/** A string with every secret overwritten. */
export function redactText(text: string): Redacted<string> {
  const { bytes, matches } = redactBytes(new TextEncoder().encode(text));
  return matches.length === 0
    ? { value: text, secrets: 0 }
    : { value: new TextDecoder().decode(bytes), secrets: matches.length };
}

/**
 * Redacts every string inside a parsed JSON value separately, so no match
 * spans two values. `visit` may take over an object, such as a base64 body
 * that must be decoded first.
 */
export function redactJsonValues(
  value: unknown,
  visit?: (record: Record<string, unknown>) => Redacted<unknown> | null,
): Redacted<unknown> {
  if (typeof value === "string") return redactText(value);
  let secrets = 0;
  const walk = (item: unknown): unknown => {
    const redacted = redactJsonValues(item, visit);
    secrets += redacted.secrets;
    return redacted.value;
  };
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => walk(item));
    return { value: items, secrets };
  }
  const record = asRecord(value);
  if (record === null) return { value, secrets: 0 };
  const visited = visit?.(record) ?? null;
  if (visited !== null) return visited;
  const entries = Object.entries(record).map(
    ([key, item]) => [key, walk(item)] as const,
  );
  return { value: Object.fromEntries(entries), secrets };
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const NEWLINE = 0x0a;

/**
 * Secrets in each JSON string literal of a spool file, by file offset. A
 * string ends at its closing quote or, in a torn line, at the newline, so a
 * match stays inside one value of one record.
 */
function spoolSecrets(bytes: Uint8Array): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const scan = (start: number, end: number) => {
    for (const match of findSecrets(bytes.subarray(start, end))) {
      matches.push({ ...match, offset: match.offset + start });
    }
  };
  let start: number | null = null;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (start === null) {
      if (byte === QUOTE) start = index + 1;
    } else if (byte === BACKSLASH && bytes[index + 1] !== NEWLINE) {
      index += 1;
    } else if (byte === QUOTE || byte === NEWLINE) {
      scan(start, index);
      start = null;
    }
  }
  if (start !== null) scan(start, bytes.length);
  return matches;
}

async function redactSpoolFile(
  file: string,
  dryRun: boolean,
): Promise<SecretMatch[]> {
  const matches = spoolSecrets(await Bun.file(file).bytes());
  if (dryRun || matches.length === 0) return matches;
  const handle = await open(file, "r+");
  try {
    for (const match of matches) {
      const current = new Uint8Array(match.length);
      await handle.read(current, 0, match.length, match.offset);
      const [found] = findSecrets(current);
      if (found?.offset !== 0 || found.length !== match.length) continue;
      const replacement = replacementFor(match);
      await handle.write(replacement, 0, replacement.length, match.offset);
    }
  } finally {
    await handle.close();
  }
  return matches;
}

async function spoolFiles(spoolDir: string): Promise<string[]> {
  try {
    const names = await readdir(spoolDir);
    return names
      .filter((name) => name.endsWith(".jsonl") || name.endsWith(".jsonl.part"))
      .map((name) => path.join(spoolDir, name));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}

const HashRowSchema = z.object({ hash: z.string() });

const BLOB_REFERENCES = [
  ["capture_blocks", "hash"],
  ["captures", "envelope_hash"],
  ["captures", "response_hash"],
  ["captures", "raw_request_hash"],
  ["captures", "raw_response_hash"],
] as const;

export async function redactCaptures(options: {
  readonly store: CaptureStore | null;
  readonly spoolDir: string;
  readonly dryRun: boolean;
}): Promise<CaptureRedactReport> {
  const all: SecretMatch[] = [];
  const files = await spoolFiles(options.spoolDir);
  let redactedSpoolFiles = 0;
  for (const file of files) {
    const matches = await redactSpoolFile(file, options.dryRun);
    if (matches.length > 0) redactedSpoolFiles += 1;
    all.push(...matches);
  }
  let blobs = 0;
  let redactedBlobs = 0;
  const { store } = options;
  if (store !== null) {
    const hashes = store
      .all("SELECT hash FROM blobs")
      .map((row) => HashRowSchema.parse(row).hash);
    blobs = hashes.length;
    for (const hash of hashes) {
      const { bytes, matches } = redactBytes(store.blob(hash));
      if (matches.length === 0) continue;
      redactedBlobs += 1;
      all.push(...matches);
      if (options.dryRun) continue;
      store.transaction(() => {
        const replacement = store.putBlob(bytes);
        if (replacement !== hash) {
          for (const [table, column] of BLOB_REFERENCES) {
            store.run(
              `UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`,
              replacement,
              hash,
            );
          }
          store.run("DELETE FROM blobs WHERE hash = ?", hash);
        }
      });
    }
    await store.secure();
  }
  return {
    spoolFiles: files.length,
    redactedSpoolFiles,
    blobs,
    redactedBlobs,
    totals: countByKind(all),
    dryRun: options.dryRun,
  };
}
