import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  bodyBytes,
  CaptureRecordSchema,
  type CaptureRecord,
} from "#lib/brim/capture/record.ts";
import { redactBytes } from "#lib/brim/sync/redact.ts";
import { applyRecord } from "./apply.ts";
import { redactJsonValues, type Redacted } from "./redact.ts";
import type { CaptureStore } from "./store.ts";

/**
 * Consumes closed spool segments into `captures.sqlite`.
 *
 * Each record is parsed, then every string in it is redacted on its own with
 * the `brim sync` patterns (a base64 body is decoded first, which hides its
 * text from a pass over the encoded form), so no match can span two records
 * or values. The records are applied in one transaction together with their
 * `spool_segments` row, and then the segment is deleted, so a crash between
 * commit and delete never applies it twice. A record that does not match the
 * contract stops ingestion with its segment and line: the producer is
 * broken, and guessing would corrupt the store.
 */

const SEGMENT_SUFFIX = ".jsonl";
const DAY_MS = 86_400_000;

export type CaptureIngestReport = {
  readonly segments: number;
  readonly records: number;
  readonly captures: number;
  readonly redactedSecrets: number;
  /** Unterminated final lines from a proxy that crashed mid-write. */
  readonly tornLines: number;
  readonly prunedCaptures: number;
};

/** A `{ base64 }` body, redacted as its decoded bytes. */
function redactBase64Body(
  record: Record<string, unknown>,
): Redacted<unknown> | null {
  const { base64 } = record;
  if (typeof base64 !== "string" || Object.keys(record).length !== 1) {
    return null;
  }
  const { bytes, matches } = redactBytes(bodyBytes({ base64 }));
  return matches.length === 0
    ? { value: record, secrets: 0 }
    : {
        value: { base64: Buffer.from(bytes).toString("base64") },
        secrets: matches.length,
      };
}

/**
 * Parses and redacts a segment, one record at a time; a torn final line is
 * counted, not parsed.
 */
export function parseSegment(
  name: string,
  bytes: Uint8Array,
): { records: CaptureRecord[]; secrets: number; torn: boolean } {
  const text = new TextDecoder().decode(bytes);
  const end = text.lastIndexOf("\n") + 1;
  let secrets = 0;
  const records = text
    .slice(0, end)
    .split("\n")
    .flatMap((line, index) => {
      if (line.length === 0) return [];
      const where = `${name}:${String(index + 1)}`;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error: unknown) {
        throw new Error(`${where} is not JSON`, { cause: error });
      }
      const redacted = redactJsonValues(json, redactBase64Body);
      const parsed = CaptureRecordSchema.safeParse(redacted.value);
      if (!parsed.success) {
        throw new Error(
          `${where} is not a capture record: ${parsed.error.message}`,
        );
      }
      secrets += redacted.secrets;
      return [parsed.data];
    });
  return { records, secrets, torn: end < text.length };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Closed segments, oldest first. */
export async function spoolSegments(spoolDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(spoolDir);
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(SEGMENT_SUFFIX)).toSorted();
}

const CountRowSchema = z.object({ count: z.number() });

/**
 * Deletes captures older than the retention window, WebSockets closed before
 * it, and orphaned blobs.
 */
export function pruneCaptures(
  store: CaptureStore,
  retentionDays: number,
  now: Date,
): number {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return store.transaction(() => {
    // `changes` would also count the cascaded block rows.
    const { count } = CountRowSchema.parse(
      store.get(
        "SELECT COUNT(*) AS count FROM captures WHERE started_at < ?",
        cutoff,
      ),
    );
    store.run("DELETE FROM captures WHERE started_at < ?", cutoff);
    // An open WebSocket keeps its row however old: its later messages need it.
    store.run(
      "DELETE FROM ws_flows WHERE closed_at IS NOT NULL AND closed_at < ?",
      cutoff,
    );
    store.run("DELETE FROM spool_segments WHERE ingested_at < ?", cutoff);
    if (count > 0) {
      store.run(`DELETE FROM blobs WHERE hash NOT IN (
        SELECT hash FROM capture_blocks
        UNION SELECT envelope_hash FROM captures WHERE envelope_hash IS NOT NULL
        UNION SELECT response_hash FROM captures WHERE response_hash IS NOT NULL
        UNION SELECT raw_request_hash FROM captures WHERE raw_request_hash IS NOT NULL
        UNION SELECT raw_response_hash FROM captures WHERE raw_response_hash IS NOT NULL)`);
    }
    return count;
  });
}

/** Applies one segment unless it was already ingested; returns new captures. */
function applySegment(
  store: CaptureStore,
  name: string,
  records: readonly CaptureRecord[],
  now: Date,
): number {
  return store.transaction(() => {
    if (
      store.get("SELECT name FROM spool_segments WHERE name = ?", name) != null
    ) {
      return 0;
    }
    const created = records.filter((record) =>
      applyRecord(store, record),
    ).length;
    store.run(
      "INSERT INTO spool_segments (name, ingested_at, records) VALUES (?, ?, ?)",
      name,
      now.toISOString(),
      records.length,
    );
    return created;
  });
}

export async function ingestCaptureSpool(options: {
  readonly store: CaptureStore;
  readonly spoolDir: string;
  readonly retentionDays: number;
  readonly now?: Date;
}): Promise<CaptureIngestReport> {
  const { store } = options;
  const now = options.now ?? new Date();
  let records = 0;
  let captures = 0;
  let redactedSecrets = 0;
  let tornLines = 0;
  const names = await spoolSegments(options.spoolDir);
  for (const name of names) {
    const segmentPath = path.join(options.spoolDir, name);
    const parsed = parseSegment(name, await Bun.file(segmentPath).bytes());
    captures += applySegment(store, name, parsed.records, now);
    await rm(segmentPath);
    records += parsed.records.length;
    redactedSecrets += parsed.secrets;
    if (parsed.torn) tornLines += 1;
  }
  const prunedCaptures = pruneCaptures(store, options.retentionDays, now);
  await store.secure();
  return {
    segments: names.length,
    records,
    captures,
    redactedSecrets,
    tornLines,
    prunedCaptures,
  };
}
