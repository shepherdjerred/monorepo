import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scanCodexCatalog } from "./codex-catalog.ts";
import {
  readCodexHistoryJsonl,
  scanCodexHistoryJsonl,
} from "./codex-history.ts";
import { createConductorSource } from "./conductor.ts";
import { createCursorSource } from "./cursor.ts";
import {
  historyMessageRole,
  INDEXED_MESSAGE_PARSE_LIMIT,
  makeHistoryDocument,
  openingPrompt,
  parseCodexItem,
  parseConversationEnvelope,
} from "./messages.ts";
import { createOpenCodeSources } from "./opencode.ts";
import type { HistoryPaths } from "./paths.ts";
import {
  filesUnder,
  firstText,
  pathExists,
  readDatabase,
  requireTables,
  rows,
  sourceReadResult,
  sourceResult,
} from "./sources-shared.ts";
import {
  parseJsonLine,
  parseRecord,
  parseTimestamp,
  stringValue,
} from "./text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
  HistorySourceReadResult,
  HistorySourceResult,
} from "./types.ts";

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function batches<T>(values: readonly T[], size = 8): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

type ClaudeTranscript = {
  readonly messages: readonly HistoryMessage[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly runtimeId: string | null;
};

async function readClaudeTranscript(
  file: string,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<ClaudeTranscript> {
  const raw = await Bun.file(file).text();
  const messages: HistoryMessage[] = [];
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let runtimeId: string | null = null;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const value = parseJsonLine(line);
    const record = parseRecord(value);
    if (record === null) {
      continue;
    }
    runtimeId ??=
      stringValue(record["sessionId"]) ?? stringValue(record["session_id"]);
    const timestamp = stringValue(record["timestamp"]);
    if (timestamp !== null) {
      const parsedTimestamp = parseTimestamp(timestamp, new Date(0));
      createdAt ??= parsedTimestamp;
      updatedAt = parsedTimestamp;
    }
    messages.push(
      ...parseConversationEnvelope(
        value,
        historyMessageRole(record["type"]),
        timestamp === null ? null : parseTimestamp(timestamp, new Date(0)),
        maxCharacters,
      ),
    );
  }
  return { messages, createdAt, updatedAt, runtimeId };
}

async function scanClaude(paths: HistoryPaths): Promise<HistorySourceResult> {
  const files = await filesUnder(paths.claudeProjects, ".jsonl");
  return sourceResult("claude", files, async () => {
    const documents: HistoryDocument[] = [];
    for (const file of files) {
      const transcript = await readClaudeTranscript(
        file,
        INDEXED_MESSAGE_PARSE_LIMIT,
      );
      const info = await stat(file);
      const fallback = new Date(info.mtimeMs).toISOString();
      const firstUser = openingPrompt(transcript.messages);
      documents.push(
        makeHistoryDocument(
          {
            source: "claude",
            sourceId: path.relative(paths.claudeProjects, file),
            title: firstText(
              firstUser ?? path.basename(file, ".jsonl"),
              "Claude Code session",
            ),
            path: file,
            workspace: path.dirname(path.dirname(file)),
            agent: "Claude Code",
            createdAt: transcript.createdAt ?? fallback,
            updatedAt: transcript.updatedAt ?? fallback,
            runtimeId: transcript.runtimeId,
          },
          transcript.messages,
        ),
      );
    }
    return documents;
  });
}

async function readClaude(
  _paths: HistoryPaths,
  records: readonly HistoryRecord[],
): Promise<HistorySourceReadResult> {
  return sourceReadResult(
    "claude",
    records.map((record) => record.sourceId),
    async () => {
      const messages = new Map<string, readonly HistoryMessage[]>();
      for (const record of records) {
        const transcript = await readClaudeTranscript(record.path);
        messages.set(record.sourceId, transcript.messages);
      }
      return messages;
    },
  );
}

type CodexItem = {
  readonly threadId: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

function codexThreadMessages(
  filePath: string,
  threadIds: readonly string[] | null = null,
  maxCharacters = Number.POSITIVE_INFINITY,
): ReadonlyMap<string, readonly HistoryMessage[]> {
  const database = readDatabase(filePath);
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

function scanCodexThreadDatabase(filePath: string): HistoryDocument[] {
  const database = readDatabase(filePath);
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
  const messages = codexThreadMessages(
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
      },
      threadMessages,
    );
  });
}

async function scanCodex(paths: HistoryPaths): Promise<HistorySourceResult> {
  const historyFiles = await filesUnder(paths.codexDir);
  const threadFiles = historyFiles.filter((file) =>
    /thread_history_.*\.sqlite$/u.test(file),
  );
  const files = [
    ...threadFiles,
    paths.codexCatalogDb,
    paths.codexHistoryJsonl,
  ].filter((file, index, all) => all.indexOf(file) === index);
  const existingFiles: string[] = [];
  for (const file of files) {
    if (await pathExists(file)) {
      existingFiles.push(file);
    }
  }
  return sourceResult("codex", existingFiles, async () => {
    const threadDocuments: HistoryDocument[] = [];
    for (const file of threadFiles) {
      if (await pathExists(file)) {
        threadDocuments.push(...scanCodexThreadDatabase(file));
      }
    }
    const catalogDocuments = (await pathExists(paths.codexCatalogDb))
      ? scanCodexCatalog(paths.codexCatalogDb)
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
        ...catalogDocuments.filter(
          (document) =>
            document.runtimeId === null ||
            !indexedThreadIds.has(document.runtimeId),
        ),
      );
    }
    if (await pathExists(paths.codexHistoryJsonl)) {
      documents.push(...(await scanCodexHistoryJsonl(paths.codexHistoryJsonl)));
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
        ? scanCodexCatalog(paths.codexCatalogDb)
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
          const messages = codexThreadMessages(filePath, threadIds);
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

export function createHistorySources(): readonly HistorySource[] {
  return [
    createConductorSource(),
    {
      name: "claude",
      label: "Claude Code",
      scan: scanClaude,
      read: readClaude,
    },
    { name: "codex", label: "Codex", scan: scanCodex, read: readCodex },
    createCursorSource(),
    ...createOpenCodeSources(),
  ];
}
