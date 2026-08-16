import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HistoryPaths } from "./paths.ts";
import { createOpenCodeSources } from "./opencode.ts";
import {
  filesUnder,
  firstText,
  pathExists,
  readDatabase,
  requireTables,
  rowValue,
  rows,
  RowSchema,
  sourceResult,
} from "./sources-shared.ts";
import {
  cleanText,
  extractText,
  parseJsonLine,
  parseRecord,
  parseTimestamp,
  stringValue,
} from "./text.ts";
import type {
  HistoryDocument,
  HistorySource,
  HistorySourceResult,
} from "./types.ts";

async function scanConductor(
  paths: HistoryPaths,
): Promise<HistorySourceResult> {
  const files = (await pathExists(paths.conductorDb))
    ? [paths.conductorDb]
    : [];
  return sourceResult("conductor", files, () => {
    const database = readDatabase(paths.conductorDb);
    try {
      requireTables(database, "Conductor", ["sessions", "session_messages"]);
      const sessionRows = rows(
        database,
        `SELECT s.id, s.title, s.created_at, s.updated_at, s.model,
                s.agent_type, s.workspace_id,
                GROUP_CONCAT(COALESCE(sm.content, sm.full_message, ''), '\n') AS body
           FROM sessions s
           LEFT JOIN session_messages sm ON sm.session_id = s.id
          GROUP BY s.id, s.title, s.created_at, s.updated_at, s.model,
                   s.agent_type, s.workspace_id`,
        RowSchema,
      );
      return sessionRows.map((row) => {
        const body = stringValue(rowValue(row, "body")) ?? "";
        const title = stringValue(rowValue(row, "title")) ?? "Untitled";
        const createdAt =
          stringValue(rowValue(row, "created_at")) ?? new Date(0).toISOString();
        const updatedAt = stringValue(rowValue(row, "updated_at")) ?? createdAt;
        return {
          source: "conductor",
          sourceId: String(rowValue(row, "id")),
          title: firstText(title, "Conductor session"),
          path: paths.conductorDb,
          workspace: stringValue(rowValue(row, "workspace_id")),
          agent:
            stringValue(rowValue(row, "agent_type")) ??
            stringValue(rowValue(row, "model")),
          createdAt: parseTimestamp(createdAt, new Date(0)),
          updatedAt: parseTimestamp(updatedAt, new Date(0)),
          searchText: `${title}\n${body}`,
        } satisfies HistoryDocument;
      });
    } finally {
      database.close();
    }
  });
}

async function scanClaude(paths: HistoryPaths): Promise<HistorySourceResult> {
  const files = await filesUnder(paths.claudeProjects, ".jsonl");
  return sourceResult("claude", files, async () => {
    const documents: HistoryDocument[] = [];
    for (const file of files) {
      const raw = await Bun.file(file).text();
      const lines = raw.split("\n");
      const textChunks: string[] = [];
      let createdAt: string | null = null;
      let updatedAt: string | null = null;
      let title: string | null = null;
      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }
        const value = parseJsonLine(line);
        const record = parseRecord(value);
        if (record === null) {
          continue;
        }
        const timestamp = stringValue(record["timestamp"]);
        if (createdAt === null && timestamp !== null) {
          createdAt = parseTimestamp(timestamp, new Date(0));
        }
        if (timestamp !== null) {
          updatedAt = parseTimestamp(timestamp, new Date(0));
        }
        const text = cleanText(extractText(record));
        if (text.length > 0) {
          textChunks.push(text);
          if (
            title === null &&
            (record["type"] === "user" || record["type"] === "human")
          ) {
            title = firstText(text, "Claude Code session");
          }
        }
      }
      const info = await stat(file);
      const fallback = new Date(info.mtimeMs);
      documents.push({
        source: "claude",
        sourceId: path.relative(paths.claudeProjects, file),
        title: title ?? path.basename(file, ".jsonl"),
        path: file,
        workspace: path.dirname(path.dirname(file)),
        agent: "Claude Code",
        createdAt: createdAt ?? fallback.toISOString(),
        updatedAt: updatedAt ?? fallback.toISOString(),
        searchText: textChunks.join("\n"),
      });
    }
    return documents;
  });
}

type CodexItem = {
  readonly threadId: string;
  readonly itemJson: string;
  readonly createdAtMs: number;
};

function scanCodexThreadDatabase(filePath: string): HistoryDocument[] {
  const database = readDatabase(filePath);
  try {
    requireTables(database, "Codex thread history", ["thread_items"]);
    const itemRows = rows(
      database,
      "SELECT thread_id, item_json, created_at_ms FROM thread_items ORDER BY thread_id, rollout_ordinal",
      z.object({
        thread_id: z.string(),
        item_json: z.string(),
        created_at_ms: z.number(),
      }),
    );
    const groups = new Map<string, CodexItem[]>();
    for (const row of itemRows) {
      const group = groups.get(row.thread_id) ?? [];
      group.push({
        threadId: row.thread_id,
        itemJson: row.item_json,
        createdAtMs: row.created_at_ms,
      });
      groups.set(row.thread_id, group);
    }
    return [...groups.values()].map((items) => {
      const first = items[0];
      if (first === undefined) {
        throw new TypeError("Codex thread group was empty");
      }
      const text = items
        .map((item) => extractText(parseJsonLine(item.itemJson)))
        .filter((chunk) => chunk.length > 0)
        .join("\n");
      const createdAt = new Date(first.createdAtMs).toISOString();
      const updatedAt = new Date(
        items.at(-1)?.createdAtMs ?? first.createdAtMs,
      ).toISOString();
      return {
        source: "codex",
        sourceId: `${filePath}:${first.threadId}`,
        title: firstText(text, first.threadId),
        path: filePath,
        workspace: null,
        agent: "Codex",
        createdAt,
        updatedAt,
        searchText: text,
      } satisfies HistoryDocument;
    });
  } finally {
    database.close();
  }
}

async function scanCodexHistoryJsonl(
  filePath: string,
): Promise<HistoryDocument[]> {
  const raw = await Bun.file(filePath).text();
  const info = await stat(filePath);
  return raw
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.line.length > 0)
    .map((entry) => {
      const value = parseJsonLine(entry.line);
      const record = parseRecord(value);
      const text = cleanText(extractText(value));
      const timestamp =
        record?.["timestamp"] ?? record?.["created_at"] ?? record?.["time"];
      const updatedAt = parseTimestamp(timestamp, new Date(info.mtimeMs));
      return {
        source: "codex",
        sourceId: `${filePath}:line:${String(entry.index + 1)}`,
        title: firstText(text, "Codex history entry"),
        path: filePath,
        workspace: null,
        agent: "Codex",
        createdAt: updatedAt,
        updatedAt,
        searchText: text,
      } satisfies HistoryDocument;
    });
}

function scanCodexCatalog(filePath: string): HistoryDocument[] {
  const database = readDatabase(filePath);
  try {
    requireTables(database, "Codex catalog", ["local_thread_catalog"]);
    const catalogRows = rows(
      database,
      `SELECT host_id, thread_id, display_title, source_created_at,
              source_updated_at, cwd, model_provider, git_branch
         FROM local_thread_catalog
        WHERE missing_candidate = 0`,
      RowSchema,
    );
    return catalogRows.map((row) => {
      const title =
        stringValue(rowValue(row, "display_title")) ?? "Codex thread";
      const workspace = stringValue(rowValue(row, "cwd"));
      const branch = stringValue(rowValue(row, "git_branch"));
      const text = `${title}\n${workspace ?? ""}\n${branch ?? ""}`;
      return {
        source: "codex",
        sourceId: `${filePath}:${String(rowValue(row, "host_id"))}:${String(rowValue(row, "thread_id"))}`,
        title: firstText(title, "Codex thread"),
        path: filePath,
        workspace,
        agent: stringValue(rowValue(row, "model_provider")) ?? "Codex",
        createdAt: parseTimestamp(
          rowValue(row, "source_created_at"),
          new Date(0),
        ),
        updatedAt: parseTimestamp(
          rowValue(row, "source_updated_at"),
          new Date(0),
        ),
        searchText: text,
      } satisfies HistoryDocument;
    });
  } finally {
    database.close();
  }
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
    const documents: HistoryDocument[] = [];
    for (const file of threadFiles) {
      if (await pathExists(file)) {
        documents.push(...scanCodexThreadDatabase(file));
      }
    }
    if (await pathExists(paths.codexCatalogDb)) {
      documents.push(...scanCodexCatalog(paths.codexCatalogDb));
    }
    if (await pathExists(paths.codexHistoryJsonl)) {
      documents.push(...(await scanCodexHistoryJsonl(paths.codexHistoryJsonl)));
    }
    return documents;
  });
}

async function scanCursor(paths: HistoryPaths): Promise<HistorySourceResult> {
  const files = (await pathExists(paths.cursorConversationDb))
    ? [paths.cursorConversationDb]
    : [];
  return sourceResult("cursor", files, () => {
    const database = readDatabase(paths.cursorConversationDb);
    try {
      requireTables(database, "Cursor conversation search", [
        "conversations",
        "conversation_fts",
      ]);
      const conversationRows = rows(
        database,
        `SELECT c.fts_rowid, c.source, c.scope, c.id, c.title, c.updated_at,
                f.body
           FROM conversations c
           JOIN conversation_fts f ON f.rowid = c.fts_rowid`,
        RowSchema,
      );
      return conversationRows.map((row) => {
        const title =
          stringValue(rowValue(row, "title")) ?? "Cursor conversation";
        const body = stringValue(rowValue(row, "body")) ?? "";
        const updatedAt = parseTimestamp(
          rowValue(row, "updated_at"),
          new Date(0),
        );
        return {
          source: "cursor",
          sourceId: `${String(rowValue(row, "source"))}:${String(rowValue(row, "scope"))}:${String(rowValue(row, "id"))}`,
          title: firstText(title, "Cursor conversation"),
          path: paths.cursorConversationDb,
          workspace: stringValue(rowValue(row, "scope")),
          agent: "Cursor",
          createdAt: updatedAt,
          updatedAt,
          searchText: `${title}\n${body}`,
        } satisfies HistoryDocument;
      });
    } finally {
      database.close();
    }
  });
}

export function createHistorySources(): readonly HistorySource[] {
  return [
    { name: "conductor", label: "Conductor", scan: scanConductor },
    { name: "claude", label: "Claude Code", scan: scanClaude },
    { name: "codex", label: "Codex", scan: scanCodex },
    { name: "cursor", label: "Cursor", scan: scanCursor },
    ...createOpenCodeSources(),
  ];
}
