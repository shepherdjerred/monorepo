import type { Database } from "bun:sqlite";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  trajectoryTimestampMs,
  usageEventsFromGenMetadata,
  usageEventsFromStep,
  type UsageEvent,
} from "./antigravity-usage.ts";
import type { HistoryPaths } from "@shepherdjerred/toolkit/lib/history/paths.ts";
import {
  pathExists,
  readImmutableDatabase,
  rows,
  sourceReadResult,
  sourceResult,
} from "@shepherdjerred/toolkit/lib/history/sources-shared.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
} from "@shepherdjerred/toolkit/lib/history/types.ts";
import {
  catalogCost,
  usageEventEntry,
} from "@shepherdjerred/toolkit/lib/history/usage-cost.ts";

const BlobRowSchema = z.object({ data: z.instanceof(Uint8Array) });
const StepMetadataRowSchema = z.object({ metadata: z.instanceof(Uint8Array) });
const TableNameSchema = z.object({ name: z.string() });

function documentTitle(
  usageEvents: readonly { readonly model: string }[],
  runtimeId: string,
): string {
  if (usageEvents.length === 0) {
    return `Antigravity session ${runtimeId}`;
  }
  const models = [...new Set(usageEvents.map((event) => event.model))];
  const modelLabel =
    models.length === 1
      ? (models[0] ?? "unknown")
      : `${String(models.length)} models`;
  return `${String(usageEvents.length)} generations, ${modelLabel}`;
}

function tableNames(database: Database): ReadonlySet<string> {
  return new Set(
    rows(
      database,
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
      TableNameSchema,
    ).map((row) => row.name),
  );
}

/**
 * `readImmutableDatabase` already gives this an internally-consistent,
 * point-in-time snapshot of the whole file, so a decode failure here means
 * genuine corruption or a protobuf schema change — not a torn read. It
 * propagates (rather than skipping just this row) so a systematic schema
 * drift fails the scan loudly instead of silently indexing partial or empty
 * usage and overwriting whatever was previously indexed correctly.
 */
function scanTrajectoryFallbackMs(
  database: Database,
  tables: ReadonlySet<string>,
): number | null {
  if (!tables.has("trajectory_metadata_blob")) {
    return null;
  }
  let fallbackMs: number | null = null;
  for (const row of rows(
    database,
    "SELECT data FROM trajectory_metadata_blob",
    BlobRowSchema,
  )) {
    const ms = trajectoryTimestampMs(row.data);
    if (ms !== null) {
      fallbackMs = fallbackMs === null ? ms : Math.min(fallbackMs, ms);
    }
  }
  return fallbackMs;
}

type TimedUsageEvent = {
  readonly event: UsageEvent;
  readonly timestampMs: number | null;
};

function scanGenMetadataEvents(
  database: Database,
  tables: ReadonlySet<string>,
  trajectoryFallbackMs: number | null,
): TimedUsageEvent[] {
  if (!tables.has("gen_metadata")) {
    return [];
  }
  const timedEvents: TimedUsageEvent[] = [];
  for (const row of rows(
    database,
    "SELECT data FROM gen_metadata",
    BlobRowSchema,
  )) {
    const result = usageEventsFromGenMetadata(row.data, trajectoryFallbackMs);
    for (const event of result.events) {
      timedEvents.push({ event, timestampMs: result.timestampMs });
    }
  }
  return timedEvents;
}

function scanStepEvents(
  database: Database,
  tables: ReadonlySet<string>,
  trajectoryFallbackMs: number | null,
): TimedUsageEvent[] {
  if (!tables.has("steps")) {
    return [];
  }
  const timedEvents: TimedUsageEvent[] = [];
  for (const row of rows(
    database,
    "SELECT metadata FROM steps WHERE metadata IS NOT NULL",
    StepMetadataRowSchema,
  )) {
    const result = usageEventsFromStep(row.metadata, trajectoryFallbackMs);
    for (const event of result.events) {
      timedEvents.push({ event, timestampMs: result.timestampMs });
    }
  }
  return timedEvents;
}

async function buildAntigravityDocument(
  database: Database,
  filePath: string,
): Promise<HistoryDocument> {
  const tables = tableNames(database);
  const trajectoryFallbackMs = scanTrajectoryFallbackMs(database, tables);
  const timedEvents = [
    ...scanGenMetadataEvents(database, tables, trajectoryFallbackMs),
    ...scanStepEvents(database, tables, trajectoryFallbackMs),
  ];
  const timestampsMs = timedEvents.flatMap((timed) =>
    timed.timestampMs === null ? [] : [timed.timestampMs],
  );

  const info = await stat(filePath);
  const fallbackMs = info.mtimeMs;
  const earliestMs =
    timestampsMs.length > 0
      ? Math.min(...timestampsMs)
      : (trajectoryFallbackMs ?? fallbackMs);
  const latestMs =
    timestampsMs.length > 0
      ? Math.max(...timestampsMs)
      : (trajectoryFallbackMs ?? fallbackMs);

  const runtimeId = path.basename(filePath, ".db");
  const usageEvents = timedEvents.map((timed) => {
    const model = timed.event.modelCandidates[0] ?? "unknown";
    return usageEventEntry(
      new Date(timed.timestampMs ?? fallbackMs).toISOString(),
      model,
      timed.event.usage,
      catalogCost(timed.event.modelCandidates, timed.event.usage),
    );
  });

  return {
    source: "antigravity",
    sourceId: filePath,
    title: documentTitle(usageEvents, runtimeId),
    path: filePath,
    workspace: null,
    agent: "Antigravity",
    createdAt: new Date(earliestMs).toISOString(),
    updatedAt: new Date(latestMs).toISOString(),
    runtimeId,
    openingPromptHash: null,
    dialogueText: "",
    toolOutputText: "",
    usageEvents,
  } satisfies HistoryDocument;
}

/**
 * Every error here — including a transient `LiveWalError` for a file
 * Antigravity is actively writing — propagates out to fail the whole
 * source's `scan()` for this pass rather than being treated as "this file is
 * gone." A per-file skip would still report scan success; because the
 * fingerprint includes that file's now-changed `-wal`/`-shm` mtimes,
 * ingestion would see "changed" and delete the file's previously indexed
 * document and usage. Failing the whole pass instead leaves the last-known
 * good index untouched — the daemon's next periodic rescan picks the file up
 * once it's no longer being written.
 */
async function scanAntigravityDatabase(
  filePath: string,
): Promise<HistoryDocument> {
  const database = await readImmutableDatabase(filePath, "Antigravity");
  try {
    return await buildAntigravityDocument(database, filePath);
  } finally {
    database.close();
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function antigravityDatabaseFiles(root: string): Promise<string[]> {
  const conversationsDir = path.join(root, "conversations");
  const dir = (await isDirectory(conversationsDir)) ? conversationsDir : root;
  if (!(await isDirectory(dir))) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

const ANTIGRAVITY_NO_TRANSCRIPT_TEXT =
  "Antigravity session — no transcript text available locally";

export function createAntigravitySource(): HistorySource {
  return {
    name: "antigravity",
    label: "Antigravity",
    async scan(paths: HistoryPaths) {
      const filesByRoot = await Promise.all(
        paths.antigravityRoots.map((root) => antigravityDatabaseFiles(root)),
      );
      const files = filesByRoot.flat();
      return sourceResult("antigravity", files, async () => {
        const documents: HistoryDocument[] = [];
        for (const file of files) {
          documents.push(await scanAntigravityDatabase(file));
        }
        return documents;
      });
    },
    async read(_paths: HistoryPaths, records: readonly HistoryRecord[]) {
      return sourceReadResult(
        "antigravity",
        records.map((record) => record.sourceId),
        async () => {
          const messages = new Map<string, readonly HistoryMessage[]>();
          for (const record of records) {
            if (await pathExists(record.sourceId)) {
              messages.set(record.sourceId, [
                {
                  role: "unknown",
                  text: ANTIGRAVITY_NO_TRANSCRIPT_TEXT,
                  createdAt: null,
                },
              ]);
            }
          }
          return messages;
        },
      );
    },
  };
}
