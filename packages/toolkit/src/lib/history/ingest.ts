import type { Database } from "bun:sqlite";
import { z } from "zod";
import type {
  HistoryDocument,
  HistorySourceName,
  HistorySourceResult,
} from "./types.ts";

const SourceStateRowSchema = z.object({
  fingerprint: z.string(),
  available: z.number(),
  error: z.string().nullable(),
});

function sourceNeedsIngest(
  force: boolean,
  fingerprint: string,
  previousState: z.infer<typeof SourceStateRowSchema> | null,
): boolean {
  return (
    force ||
    previousState?.available !== 1 ||
    previousState.error !== null ||
    previousState.fingerprint !== fingerprint
  );
}

function hashDocument(
  title: string,
  dialogue: string,
  toolOutput: string,
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify([title, dialogue, toolOutput]));
  return hasher.digest("hex");
}

function countDocuments(database: Database, source: HistorySourceName): number {
  return z
    .object({ count: z.number() })
    .parse(
      database
        .prepare("SELECT count(*) AS count FROM documents WHERE source = ?")
        .get(source),
    ).count;
}

/**
 * Upsert every source's scanned documents into the index, dropping any that
 * disappeared since the last scan. A source whose fingerprint (file
 * mtime+size hash) hasn't changed since the last successful ingest is
 * skipped entirely — this is what makes repeated scans cheap.
 */
type IngestStatements = {
  readonly upsert: ReturnType<Database["prepare"]>;
  readonly findExisting: ReturnType<Database["prepare"]>;
  readonly insertFts: ReturnType<Database["prepare"]>;
  readonly deleteFts: ReturnType<Database["prepare"]>;
  readonly deleteDocument: ReturnType<Database["prepare"]>;
  readonly deleteUsageEvents: ReturnType<Database["prepare"]>;
  readonly insertUsageEvent: ReturnType<Database["prepare"]>;
  readonly updateState: ReturnType<Database["prepare"]>;
};

function prepareIngestStatements(database: Database): IngestStatements {
  return {
    upsert: database.prepare(`
      INSERT INTO documents
        (source, source_id, title, path, workspace, agent, created_at, updated_at,
         runtime_id, opening_prompt_hash, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        title = excluded.title,
        path = excluded.path,
        workspace = excluded.workspace,
        agent = excluded.agent,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        runtime_id = excluded.runtime_id,
        opening_prompt_hash = excluded.opening_prompt_hash,
        content_hash = excluded.content_hash
    `),
    findExisting: database.prepare(
      "SELECT id, content_hash FROM documents WHERE source = ? AND source_id = ?",
    ),
    insertFts: database.prepare(
      "INSERT INTO history_fts(rowid, title, dialogue, tool_output) VALUES (?, ?, ?, ?)",
    ),
    deleteFts: database.prepare("DELETE FROM history_fts WHERE rowid = ?"),
    deleteDocument: database.prepare("DELETE FROM documents WHERE id = ?"),
    deleteUsageEvents: database.prepare(
      "DELETE FROM usage_events WHERE document_id = ?",
    ),
    insertUsageEvent: database.prepare(`
      INSERT INTO usage_events
        (document_id, source, occurred_at, model, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, cached_input_tokens,
         reasoning_tokens, cost_usd, cost_complete)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateState: database.prepare(`
      INSERT INTO source_state
        (source, available, indexed_documents, fingerprint, last_scan_at, error)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        available = excluded.available,
        indexed_documents = excluded.indexed_documents,
        fingerprint = excluded.fingerprint,
        last_scan_at = excluded.last_scan_at,
        error = excluded.error
    `),
  };
}

function upsertDocument(
  statements: IngestStatements,
  document: HistoryDocument,
): void {
  const contentHash = hashDocument(
    document.title,
    document.dialogueText,
    document.toolOutputText,
  );
  const existing = statements.findExisting.get(
    document.source,
    document.sourceId,
  );
  const existingRow =
    existing == null
      ? null
      : z.object({ id: z.number(), content_hash: z.string() }).parse(existing);
  if (existingRow !== null && existingRow.content_hash !== contentHash) {
    statements.deleteFts.run(existingRow.id);
  }
  statements.upsert.run(
    document.source,
    document.sourceId,
    document.title,
    document.path,
    document.workspace,
    document.agent,
    document.createdAt,
    document.updatedAt,
    document.runtimeId,
    document.openingPromptHash,
    contentHash,
  );
  const documentId = z
    .object({ id: z.number() })
    .parse(statements.findExisting.get(document.source, document.sourceId)).id;
  if (existingRow?.content_hash !== contentHash) {
    statements.insertFts.run(
      documentId,
      document.title,
      document.dialogueText,
      document.toolOutputText,
    );
  }
  statements.deleteUsageEvents.run(documentId);
  for (const event of document.usageEvents) {
    statements.insertUsageEvent.run(
      documentId,
      document.source,
      event.occurredAt,
      event.model,
      event.inputTokens,
      event.outputTokens,
      event.cacheReadTokens,
      event.cacheCreationTokens,
      event.cachedInputTokens,
      event.reasoningTokens,
      event.costUsd,
      event.costComplete ? 1 : 0,
    );
  }
}

function ingestSourceResult(
  database: Database,
  statements: IngestStatements,
  result: HistorySourceResult,
  force: boolean,
): void {
  const existingIds = database
    .prepare("SELECT id, source_id FROM documents WHERE source = ?")
    .all(result.source)
    .map((row: unknown) =>
      z.object({ id: z.number(), source_id: z.string() }).parse(row),
    );
  const stateRow = database
    .prepare(
      "SELECT fingerprint, available, error FROM source_state WHERE source = ?",
    )
    .get(result.source);
  const previousState =
    stateRow == null ? null : SourceStateRowSchema.parse(stateRow);
  const changed = sourceNeedsIngest(force, result.fingerprint, previousState);

  if (changed && result.available && result.error === null) {
    const seenIds = new Set(
      result.documents.map((document) => document.sourceId),
    );
    for (const document of result.documents) {
      upsertDocument(statements, document);
    }
    for (const existingId of existingIds) {
      if (!seenIds.has(existingId.source_id)) {
        statements.deleteFts.run(existingId.id);
        statements.deleteUsageEvents.run(existingId.id);
        statements.deleteDocument.run(existingId.id);
      }
    }
  }

  statements.updateState.run(
    result.source,
    result.available ? 1 : 0,
    changed && result.error === null
      ? result.documents.length
      : countDocuments(database, result.source),
    result.fingerprint,
    result.error === null && result.available ? new Date().toISOString() : null,
    result.error,
  );
}

export function ingestResults(
  database: Database,
  results: readonly HistorySourceResult[],
  force: boolean,
): void {
  const statements = prepareIngestStatements(database);
  const transaction = database.transaction(() => {
    for (const result of results) {
      ingestSourceResult(database, statements, result, force);
    }
  });
  transaction();
}
