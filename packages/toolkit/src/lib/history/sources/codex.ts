import { z } from "zod";
import {
  INDEXED_MESSAGE_PARSE_LIMIT,
  makeHistoryDocument,
  openingPrompt,
  parseCodexItem,
} from "@shepherdjerred/toolkit/lib/history/query/messages.ts";
import type { HistoryPaths } from "@shepherdjerred/toolkit/lib/history/paths.ts";
import {
  batches,
  filesUnder,
  firstText,
  pathExists,
  placeholders,
  readImmutableDatabase,
  requireTables,
  rows,
  sourceReadResult,
  sourceResult,
} from "@shepherdjerred/toolkit/lib/history/sources-shared.ts";
import { parseJsonLine } from "@shepherdjerred/toolkit/lib/history/query/text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
  HistorySourceReadResult,
  HistorySourceResult,
  UsageEventEntry,
} from "@shepherdjerred/toolkit/lib/history/types.ts";
import { scanCodexCatalog } from "./codex-catalog.ts";
import {
  readCodexHistoryJsonl,
  scanCodexHistoryJsonl,
} from "./codex-history.ts";
import { scanCodexSessionUsage } from "./codex-usage.ts";

type CodexItem = {
  readonly threadId: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

async function codexThreadMessages(
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

async function scanCodexThreadDatabase(
  filePath: string,
  usageByThread: ReadonlyMap<string, readonly UsageEventEntry[]>,
): Promise<HistoryDocument[]> {
  const database = await readImmutableDatabase(filePath, "Codex");
  let items: readonly CodexItem[];
  try {
    requireTables(database, "Codex thread history", ["thread_items"]);
    items = rows(
      database,
      `SELECT thread_id, min(created_at_ms) AS created_at_ms,
              max(created_at_ms) AS updated_at_ms
         FROM thread_items
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
    );
  } finally {
    database.close();
  }
  const messages = await codexThreadMessages(
    filePath,
    null,
    INDEXED_MESSAGE_PARSE_LIMIT,
  );
  return items.map((item) => {
    const threadMessages = messages.get(item.threadId) ?? [];
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
        usageEvents: usageByThread.get(item.threadId) ?? [],
      },
      threadMessages,
    );
  });
}

/**
 * A rollout's usage can exist with no matching `thread_history` row (a
 * CLI-only install, or history pruned/rotated independently of sessions) and
 * no catalog entry either. Without a placeholder document, `history usage`
 * would silently omit that session's tokens and cost entirely rather than
 * flagging it as unattributable to a known thread.
 */
function usageOnlyCodexDocument(
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

async function scanCodex(paths: HistoryPaths): Promise<HistorySourceResult> {
  const historyFiles = await filesUnder(paths.codexDir);
  const threadFiles = historyFiles.filter((file) =>
    /thread_history_.*\.sqlite$/u.test(file),
  );
  const sessionFiles = await filesUnder(paths.codexSessionsDir, ".jsonl");
  const files = [
    ...threadFiles,
    paths.codexCatalogDb,
    paths.codexHistoryJsonl,
    ...sessionFiles,
  ].filter((file, index, all) => all.indexOf(file) === index);
  const existingFiles: string[] = [];
  for (const file of files) {
    if (await pathExists(file)) {
      existingFiles.push(file);
    }
  }
  return sourceResult("codex", existingFiles, async () => {
    const usageByThread = await scanCodexSessionUsage(paths.codexSessionsDir);
    const threadDocuments: HistoryDocument[] = [];
    for (const file of threadFiles) {
      if (await pathExists(file)) {
        threadDocuments.push(
          ...(await scanCodexThreadDatabase(file, usageByThread)),
        );
      }
    }
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
    const indexedThreadIds = new Set(
      threadDocuments.flatMap((document) =>
        document.runtimeId === null ? [] : [document.runtimeId],
      ),
    );
    const documents = threadDocuments.map((document) => {
      const catalog =
        document.runtimeId === null
          ? undefined
          : catalogByThread.get(document.runtimeId);
      if (catalog === undefined) {
        return document;
      }
      return {
        ...document,
        title: catalog.title,
        workspace: catalog.workspace,
        agent: catalog.agent,
        toolOutputText: [document.toolOutputText, catalog.toolOutputText]
          .filter((text) => text.length > 0)
          .join("\n"),
      } satisfies HistoryDocument;
    });
    if (await pathExists(paths.codexCatalogDb)) {
      documents.push(
        ...catalogDocuments
          .filter(
            (document) =>
              document.runtimeId === null ||
              !indexedThreadIds.has(document.runtimeId),
          )
          .map((document) =>
            document.runtimeId !== null && usageByThread.has(document.runtimeId)
              ? ({
                  ...document,
                  usageEvents: usageByThread.get(document.runtimeId) ?? [],
                } satisfies HistoryDocument)
              : document,
          ),
      );
    }
    if (await pathExists(paths.codexHistoryJsonl)) {
      const historyDocuments = await scanCodexHistoryJsonl(
        paths.codexHistoryJsonl,
      );
      documents.push(
        ...historyDocuments.map((document) =>
          document.runtimeId !== null && usageByThread.has(document.runtimeId)
            ? ({
                ...document,
                usageEvents: usageByThread.get(document.runtimeId) ?? [],
              } satisfies HistoryDocument)
            : document,
        ),
      );
    }
    // Usage that matched neither a thread-history row nor a catalog entry
    // still needs a place to live — otherwise `history usage` silently
    // omits that session's tokens and cost.
    const attributedThreadIds = new Set(
      documents.flatMap((document) =>
        document.runtimeId === null ? [] : [document.runtimeId],
      ),
    );
    for (const [threadId, events] of usageByThread) {
      if (!attributedThreadIds.has(threadId)) {
        documents.push(
          usageOnlyCodexDocument(paths.codexSessionsDir, threadId, events),
        );
      }
    }
    return documents;
  });
}

async function readCodex(
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

export function createCodexSource(): HistorySource {
  return { name: "codex", label: "Codex", scan: scanCodex, read: readCodex };
}
