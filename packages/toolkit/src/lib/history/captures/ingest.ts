import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  bodyBytes,
  CaptureRecordSchema,
  type CaptureBody,
  type CaptureRecord,
} from "#lib/brim/capture/record.ts";
import { redactBytes } from "#lib/brim/sync/redact.ts";
import { applyRecord } from "./apply.ts";
import type { CaptureStore } from "./store.ts";

/**
 * Consumes closed spool segments into `captures.sqlite`.
 *
 * Each segment is redacted with the `brim sync` patterns before it is parsed,
 * and every body again once decoded (a base64 body hides its text from the
 * outer pass), then applied in one transaction together with its `spool_segments` row, and then
 * deleted, so a crash between commit and delete never applies it twice. A
 * record that does not match the contract stops ingestion with its segment
 * and line: the producer is broken, and guessing would corrupt the store.
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

/** Parses a redacted segment; a torn final line is counted, not parsed. */
export function parseSegment(
  name: string,
  bytes: Uint8Array,
): { records: CaptureRecord[]; torn: boolean } {
  const text = new TextDecoder().decode(bytes);
  const end = text.lastIndexOf("\n") + 1;
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
      const parsed = CaptureRecordSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `${where} is not a capture record: ${parsed.error.message}`,
        );
      }
      return [parsed.data];
    });
  return { records, torn: end < text.length };
}

type Redacted<T> = { readonly value: T; readonly secrets: number };

function redactBody(body: CaptureBody): Redacted<CaptureBody> {
  const { bytes, matches } = redactBytes(bodyBytes(body));
  if (matches.length === 0) return { value: body, secrets: 0 };
  const value =
    "text" in body
      ? { text: new TextDecoder().decode(bytes) }
      : { base64: Buffer.from(bytes).toString("base64") };
  return { value, secrets: matches.length };
}

function redactNullableBody(
  body: CaptureBody | null,
): Redacted<CaptureBody | null> {
  return body === null ? { value: null, secrets: 0 } : redactBody(body);
}

/** Redacts the decoded bodies of a record parsed from redacted bytes. */
function redactRecord(record: CaptureRecord): Redacted<CaptureRecord> {
  switch (record.kind) {
    case "http": {
      const request = redactNullableBody(record.request.body);
      const response = redactNullableBody(record.response?.body ?? null);
      return {
        value: {
          ...record,
          request: { ...record.request, body: request.value },
          response:
            record.response === null
              ? null
              : { ...record.response, body: response.value },
        },
        secrets: request.secrets + response.secrets,
      };
    }
    case "ws-message": {
      const body = redactBody(record.body);
      return { value: { ...record, body: body.value }, secrets: body.secrets };
    }
    case "ws-open":
    case "ws-close":
      return { value: record, secrets: 0 };
  }
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
    const bytes = await Bun.file(segmentPath).bytes();
    const redacted = redactBytes(bytes);
    const parsed = parseSegment(name, redacted.bytes);
    const bodies = parsed.records.map((record) => redactRecord(record));
    captures += applySegment(
      store,
      name,
      bodies.map((body) => body.value),
      now,
    );
    await rm(segmentPath);
    records += parsed.records.length;
    redactedSecrets += redacted.matches.length;
    for (const body of bodies) redactedSecrets += body.secrets;
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
