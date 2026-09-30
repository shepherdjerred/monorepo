import { z } from "zod";
import {
  makeHistoryDocument,
  openingPrompt,
  parseCodexItem,
} from "@shepherdjerred/toolkit/lib/history/query/messages.ts";
import type { HistoryPaths } from "@shepherdjerred/toolkit/lib/history/paths.ts";
import {
  batches,
  firstText,
  pathExists,
  placeholders,
  readImmutableDatabase,
  requireTables,
  rows,
  sourceReadResult,
} from "@shepherdjerred/toolkit/lib/history/sources-shared.ts";
import { parseJsonLine } from "@shepherdjerred/toolkit/lib/history/query/text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySourceReadResult,
  UsageEventEntry,
} from "@shepherdjerred/toolkit/lib/history/types.ts";
import { scanCodexCatalog } from "./codex-catalog.ts";
import { readCodexHistoryJsonl } from "./codex-history.ts";

type CodexItem = {
  readonly threadId: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type CodexThreadBuild = {
  readonly filePath: string;
  readonly item: CodexItem;
  readonly messages: readonly HistoryMessage[];
};

export async function codexThreadMessages(
  filePath: string,
  threadIds: readonly string[] | null = null,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<ReadonlyMap<string, readonly HistoryMessage[]>> {
  const database = await readImmutableDatabase(filePath, "Codex");
  try {
    requireTables(database, "Codex thread history", ["thread_items"]);
    const selectedThreadIds =
      threadIds ??
      rows(
        database,
        "SELECT DISTINCT thread_id FROM thread_items ORDER BY thread_id",
        z.object({ thread_id: z.string() }),
      ).map((row) => row.thread_id);
    const messages = new Map<string, HistoryMessage[]>();
    for (const batch of batches(selectedThreadIds)) {
      const itemRows = rows(
        database,
        `SELECT rowid AS history_rowid, thread_id
           FROM thread_items
          WHERE thread_id IN (${placeholders(batch.length)})
          ORDER BY thread_id, rollout_ordinal`,
        z.object({ history_rowid: z.number(), thread_id: z.string() }),
        batch,
      );
      const readItem = database.prepare(
        `SELECT item_json, item_type, created_at_ms
           FROM thread_items WHERE rowid = ?`,
      );
      for (const metadata of itemRows) {
        const row = z
          .object({
            item_json: z.string(),
            item_type: z.string(),
            created_at_ms: z.number(),
          })
          .parse(readItem.get(metadata.history_rowid));
        const createdAt = new Date(row.created_at_ms).toISOString();
        const entries = parseCodexItem(
          row.item_type,
          parseJsonLine(row.item_json),
          createdAt,
          maxCharacters,
        );
        const existing = messages.get(metadata.thread_id) ?? [];
        existing.push(...entries);
        messages.set(metadata.thread_id, existing);
      }
    }
    return messages;
  } finally {
    database.close();
  }
}

export async function codexThreadItems(
  filePath: string,
  threadIds: readonly string[] | null,
): Promise<readonly CodexItem[]> {
  const database = await readImmutableDatabase(filePath, "Codex");
  try {
    requireTables(database, "Codex thread history", ["thread_items"]);
    const filter =
      threadIds === null
        ? ""
        : `WHERE thread_id IN (${placeholders(threadIds.length)})`;
    return rows(
      database,
      `SELECT thread_id, min(created_at_ms) AS created_at_ms,
              max(created_at_ms) AS updated_at_ms
         FROM thread_items
         ${filter}
        GROUP BY thread_id
        ORDER BY thread_id`,
      z
        .object({
          thread_id: z.string(),
          created_at_ms: z.number(),
          updated_at_ms: z.number(),
        })
        .transform((row) => ({
          threadId: row.thread_id,
          createdAtMs: row.created_at_ms,
          updatedAtMs: row.updated_at_ms,
        })),
      threadIds ?? [],
    );
  } finally {
    database.close();
  }
}

export function buildCodexThreadDocument(
  filePath: string,
  item: CodexItem,
  threadMessages: readonly HistoryMessage[],
  usageEvents: readonly UsageEventEntry[],
): HistoryDocument {
  return makeHistoryDocument(
    {
      source: "codex",
      sourceId: `${filePath}:${item.threadId}`,
      title: firstText(
        openingPrompt(threadMessages) ?? item.threadId,
        item.threadId,
      ),
      path: filePath,
      workspace: null,
      agent: "Codex",
      createdAt: new Date(item.createdAtMs).toISOString(),
      updatedAt: new Date(item.updatedAtMs).toISOString(),
      runtimeId: item.threadId,
      usageEvents,
    },
    threadMessages,
  );
}

type CodexThreadSummary = {
  readonly count: number;
  readonly maxOrdinal: number;
  readonly maxUpdatedOrdinal: number | null;
};

/**
 * One watermark row per thread, answered from the `(thread_id,
 * rollout_ordinal)` index alone — no `item_json` blobs are touched, so
 * this stays cheap on gigabyte thread databases. A database that predates
 * `updated_at_ordinal` falls back to the rollout watermark rather than
 * failing the scan; anything genuinely corrupt still throws from the
 * re-read that follows.
 */
export async function codexThreadSummaries(
  filePath: string,
): Promise<ReadonlyMap<string, CodexThreadSummary>> {
  const database = await readImmutableDatabase(filePath, "Codex");
  try {
    requireTables(database, "Codex thread history", ["thread_items"]);
    try {
      return new Map(
        rows(
          database,
          `SELECT thread_id, COUNT(*) AS n,
                  MAX(rollout_ordinal) AS max_ord,
                  MAX(updated_at_ordinal) AS max_upd
             FROM thread_items
            GROUP BY thread_id`,
          z.object({
            thread_id: z.string(),
            n: z.number(),
            max_ord: z.number(),
            max_upd: z.number(),
          }),
        ).map((row) => [
          row.thread_id,
          {
            count: row.n,
            maxOrdinal: row.max_ord,
            maxUpdatedOrdinal: row.max_upd,
          } satisfies CodexThreadSummary,
        ]),
      );
    } catch {
      return new Map(
        rows(
          database,
          `SELECT thread_id, COUNT(*) AS n,
                  MAX(rollout_ordinal) AS max_ord
             FROM thread_items
            GROUP BY thread_id`,
          z.object({
            thread_id: z.string(),
            n: z.number(),
            max_ord: z.number(),
          }),
        ).map((row) => [
          row.thread_id,
          {
            count: row.n,
            maxOrdinal: row.max_ord,
            maxUpdatedOrdinal: null,
          } satisfies CodexThreadSummary,
        ]),
      );
    }
  } finally {
    database.close();
  }
}

export function threadSummarySignature(summary: CodexThreadSummary): string {
  return `${String(summary.count)}:${String(summary.maxOrdinal)}:${summary.maxUpdatedOrdinal === null ? "none" : String(summary.maxUpdatedOrdinal)}`;
}

/**
 * A rollout's usage can exist with no matching `thread_history` row (a
 * CLI-only install, or history pruned/rotated independently of sessions) and
 * no catalog entry either. Without a placeholder document, `history usage`
 * would silently omit that session's tokens and cost entirely rather than
 * flagging it as unattributable to a known thread.
 */
export function usageOnlyCodexDocument(
  sessionsDir: string,
  threadId: string,
  events: readonly UsageEventEntry[],
): HistoryDocument {
  const timestampsMs = events
    .map((event) => Date.parse(event.occurredAt))
    .filter((ms) => Number.isFinite(ms));
  const earliestMs =
    timestampsMs.length > 0 ? Math.min(...timestampsMs) : Date.now();
  const latestMs =
    timestampsMs.length > 0 ? Math.max(...timestampsMs) : earliestMs;
  return {
    source: "codex",
    sourceId: `${sessionsDir}:${threadId}`,
    title: `Codex session ${threadId} (usage only — no local transcript)`,
    path: sessionsDir,
    workspace: null,
    agent: "Codex",
    createdAt: new Date(earliestMs).toISOString(),
    updatedAt: new Date(latestMs).toISOString(),
    runtimeId: threadId,
    openingPromptHash: null,
    dialogueText: "",
    toolOutputText: "",
    usageEvents: events,
  } satisfies HistoryDocument;
}

export async function readCodex(
  paths: HistoryPaths,
  records: readonly HistoryRecord[],
): Promise<HistorySourceReadResult> {
  return sourceReadResult(
    "codex",
    records.map((record) => record.sourceId),
    async () => {
      const result = new Map<string, readonly HistoryMessage[]>();
      const catalogDocuments = (await pathExists(paths.codexCatalogDb))
        ? await scanCodexCatalog(paths.codexCatalogDb)
        : [];
      const catalogByThread = new Map(
        catalogDocuments.flatMap((document) =>
          document.runtimeId === null
            ? []
            : [[document.runtimeId, document] as const],
        ),
      );
      const catalogBySourceId = new Map(
        catalogDocuments.map((document) => [document.sourceId, document]),
      );
      const catalogMessages = (
        document: HistoryDocument | undefined,
      ): readonly HistoryMessage[] => {
        if (document === undefined) {
          return [];
        }
        const text = [document.title, document.toolOutputText]
          .filter((part) => part.length > 0)
          .join("\n");
        return [{ role: "tool", text, createdAt: document.updatedAt }];
      };
      const byPath = Map.groupBy(records, (record) => record.path);
      for (const [filePath, fileRecords] of byPath) {
        if (/thread_history_.*\.sqlite$/u.test(filePath)) {
          const threadIds = fileRecords.map((record) =>
            record.sourceId.slice(filePath.length + 1),
          );
          const messages = await codexThreadMessages(filePath, threadIds);
          for (const record of fileRecords) {
            const threadId = record.sourceId.slice(filePath.length + 1);
            const threadMessages = messages.get(threadId);
            if (threadMessages === undefined) {
              continue;
            }
            result.set(record.sourceId, [
              ...threadMessages,
              ...catalogMessages(catalogByThread.get(threadId)),
            ]);
          }
        } else if (filePath === paths.codexHistoryJsonl) {
          const selected = new Set(
            fileRecords.map((record) => record.sourceId),
          );
          const messages = await readCodexHistoryJsonl(filePath, selected);
          for (const record of fileRecords) {
            const recordMessages = messages.get(record.sourceId);
            if (recordMessages !== undefined) {
              result.set(record.sourceId, recordMessages);
            }
          }
        } else {
          for (const record of fileRecords) {
            const document = catalogBySourceId.get(record.sourceId);
            if (document !== undefined) {
              result.set(record.sourceId, catalogMessages(document));
            }
          }
        }
      }
      return result;
    },
  );
}
