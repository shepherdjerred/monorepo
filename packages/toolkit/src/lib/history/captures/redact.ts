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
import type { CaptureStore } from "./store.ts";

/**
 * Overwrites credentials in captured requests with the `brim sync` patterns:
 * in spool segments not yet ingested (in place, same length, so a proxy still
 * appending is unaffected) and in every stored blob. Ingest already redacts,
 * so this matters after a pattern is added. A redacted blob gets a new
 * content hash and every reference moves to it.
 */

export type CaptureRedactReport = {
  readonly spoolFiles: number;
  readonly redactedSpoolFiles: number;
  readonly blobs: number;
  readonly redactedBlobs: number;
  readonly totals: Partial<Record<SecretKind, number>>;
  readonly dryRun: boolean;
};

async function redactSpoolFile(
  file: string,
  dryRun: boolean,
): Promise<SecretMatch[]> {
  const matches = findSecrets(await Bun.file(file).bytes());
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
