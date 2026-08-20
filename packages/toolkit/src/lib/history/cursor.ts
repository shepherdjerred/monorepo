import {
  dialogueText,
  INDEXED_MESSAGE_PARSE_LIMIT,
  openingPrompt,
  openingPromptHash,
  toolOutputText,
} from "./messages.ts";
import type { HistoryPaths } from "./paths.ts";
import {
  firstText,
  pathExists,
  readCursorDatabase,
  requireTables,
  rowValue,
  rows,
  RowSchema,
  sourceReadResult,
  sourceResult,
} from "./sources-shared.ts";
import { cleanText, parseTimestamp, stringValue } from "./text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
} from "./types.ts";

const CURSOR_INDEX_WINDOW_LIMIT = 16;

function cursorBodyMessages(
  body: string,
  createdAt: string,
  maxCharacters: number,
): readonly HistoryMessage[] {
  if (body.length === 0) {
    return [];
  }
  if (!Number.isFinite(maxCharacters)) {
    return [{ role: "unknown", text: body, createdAt }];
  }
  const windowSize = Math.max(1, Math.floor(maxCharacters / 2));
  const windowCount = Math.min(
    CURSOR_INDEX_WINDOW_LIMIT,
    Math.ceil(body.length / windowSize),
  );
  return Array.from({ length: windowCount }, (_, index) => {
    const offset =
      windowCount === 1
        ? 0
        : Math.round(
            (index * Math.max(0, body.length - windowSize)) / (windowCount - 1),
          );
    return {
      role: "unknown",
      text: body.slice(offset, offset + windowSize),
      createdAt,
    } satisfies HistoryMessage;
  });
}

async function cursorDocuments(
  filePath: string,
  selectedIds: ReadonlySet<string> | null = null,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<HistoryDocument[]> {
  const database = await readCursorDatabase(filePath);
  try {
    requireTables(database, "Cursor conversation search", [
      "conversations",
      "conversation_fts",
    ]);
    const cursorIds =
      selectedIds === null
        ? []
        : [...selectedIds].map((sourceId) =>
            sourceId.slice(sourceId.lastIndexOf(":") + 1),
          );
    const selection =
      cursorIds.length === 0
        ? ""
        : ` WHERE c.id IN (${Array.from({ length: cursorIds.length }, () => "?").join(", ")})`;
    const conversationRows = rows(
      database,
      `SELECT c.fts_rowid, c.source, c.scope, c.id, c.title, c.updated_at, f.body
         FROM conversations c
         JOIN conversation_fts f ON f.rowid = c.fts_rowid${selection}`,
      RowSchema,
      cursorIds,
    );
    return conversationRows.flatMap((row) => {
      const sourceId = `${String(rowValue(row, "source"))}:${String(rowValue(row, "scope"))}:${String(rowValue(row, "id"))}`;
      if (selectedIds !== null && !selectedIds.has(sourceId)) {
        return [];
      }
      const title =
        stringValue(rowValue(row, "title")) ?? "Cursor conversation";
      const body = cleanText(stringValue(rowValue(row, "body")) ?? "");
      const updatedAt = parseTimestamp(
        rowValue(row, "updated_at"),
        new Date(0),
      );
      const messages = cursorBodyMessages(body, updatedAt, maxCharacters);
      return [
        {
          source: "cursor",
          sourceId,
          title: firstText(title, "Cursor conversation"),
          path: filePath,
          workspace: stringValue(rowValue(row, "scope")),
          agent: "Cursor",
          createdAt: updatedAt,
          updatedAt,
          runtimeId: String(rowValue(row, "id")),
          openingPromptHash: openingPromptHash(openingPrompt(messages)),
          dialogueText: dialogueText(messages),
          toolOutputText: toolOutputText(messages),
        } satisfies HistoryDocument,
      ];
    });
  } finally {
    database.close();
  }
}

async function cursorMessages(
  filePath: string,
  records: readonly HistoryRecord[],
): Promise<ReadonlyMap<string, readonly HistoryMessage[]>> {
  if (records.length === 0) {
    return new Map();
  }
  const selectedIds = new Set(records.map((record) => record.sourceId));
  const cursorIds = records.map((record) =>
    record.sourceId.slice(record.sourceId.lastIndexOf(":") + 1),
  );
  const database = await readCursorDatabase(filePath);
  try {
    requireTables(database, "Cursor conversation search", [
      "conversations",
      "conversation_fts",
    ]);
    const conversationRows = rows(
      database,
      `SELECT c.source, c.scope, c.id, c.updated_at, f.body
         FROM conversations c
         JOIN conversation_fts f ON f.rowid = c.fts_rowid
        WHERE c.id IN (${Array.from({ length: cursorIds.length }, () => "?").join(", ")})`,
      RowSchema,
      cursorIds,
    );
    return new Map(
      conversationRows.flatMap((row) => {
        const sourceId = `${String(rowValue(row, "source"))}:${String(rowValue(row, "scope"))}:${String(rowValue(row, "id"))}`;
        if (!selectedIds.has(sourceId)) {
          return [];
        }
        const text = cleanText(stringValue(rowValue(row, "body")) ?? "");
        const updatedAt = parseTimestamp(
          rowValue(row, "updated_at"),
          new Date(0),
        );
        return [[sourceId, cursorBodyMessages(text, updatedAt, Infinity)]];
      }),
    );
  } finally {
    database.close();
  }
}

export function createCursorSource(): HistorySource {
  return {
    name: "cursor",
    label: "Cursor",
    async scan(paths: HistoryPaths) {
      const files = (await pathExists(paths.cursorConversationDb))
        ? [paths.cursorConversationDb]
        : [];
      return sourceResult("cursor", files, () =>
        cursorDocuments(
          paths.cursorConversationDb,
          null,
          INDEXED_MESSAGE_PARSE_LIMIT,
        ),
      );
    },
    async read(paths: HistoryPaths, records: readonly HistoryRecord[]) {
      return sourceReadResult(
        "cursor",
        records.map((record) => record.sourceId),
        () => cursorMessages(paths.cursorConversationDb, records),
      );
    },
  };
}
