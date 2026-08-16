import type { HistoryPaths } from "./paths.ts";
import {
  firstText,
  pathExists,
  readDatabase,
  requireTables,
  rowValue,
  rows,
  RowSchema,
  sourceResult,
} from "./sources-shared.ts";
import { extractText, parseJsonLine, stringValue } from "./text.ts";
import type {
  HistoryDocument,
  HistorySource,
  HistorySourceResult,
} from "./types.ts";

type OpenCodeSourceName = "opencode-conductor" | "opencode-standalone";

function opencodeDocuments(
  filePath: string,
  source: OpenCodeSourceName,
): HistoryDocument[] {
  const database = readDatabase(filePath);
  try {
    requireTables(database, "OpenCode", ["session", "message", "part"]);
    const sessionRows = rows(
      database,
      "SELECT id, title, directory, agent, model, time_created, time_updated FROM session",
      RowSchema,
    );
    const messageRows = rows(
      database,
      "SELECT id, session_id, data, time_created FROM message ORDER BY session_id, time_created",
      RowSchema,
    );
    const partRows = rows(
      database,
      "SELECT message_id, data FROM part ORDER BY message_id, time_created",
      RowSchema,
    );
    const partsByMessage = new Map<string, string[]>();
    for (const row of partRows) {
      const messageId = String(rowValue(row, "message_id"));
      const text = extractText(parseJsonLine(String(rowValue(row, "data"))));
      if (text.length > 0) {
        const parts = partsByMessage.get(messageId) ?? [];
        parts.push(text);
        partsByMessage.set(messageId, parts);
      }
    }
    const messagesBySession = new Map<string, string[]>();
    for (const row of messageRows) {
      const sessionId = String(rowValue(row, "session_id"));
      const messageText = extractText(
        parseJsonLine(String(rowValue(row, "data"))),
      );
      const parts = partsByMessage.get(String(rowValue(row, "id"))) ?? [];
      const chunks = [messageText, ...parts].filter(
        (chunk) => chunk.length > 0,
      );
      const messages = messagesBySession.get(sessionId) ?? [];
      messages.push(...chunks);
      messagesBySession.set(sessionId, messages);
    }
    return sessionRows.map((row) => {
      const sessionId = String(rowValue(row, "id"));
      const title = stringValue(rowValue(row, "title")) ?? "OpenCode session";
      const body = messagesBySession.get(sessionId)?.join("\n") ?? "";
      return {
        source,
        sourceId: sessionId,
        title: firstText(title, "OpenCode session"),
        path: filePath,
        workspace: stringValue(rowValue(row, "directory")),
        agent:
          stringValue(rowValue(row, "agent")) ??
          stringValue(rowValue(row, "model")) ??
          "OpenCode",
        createdAt: new Date(
          Number(rowValue(row, "time_created")),
        ).toISOString(),
        updatedAt: new Date(
          Number(rowValue(row, "time_updated")),
        ).toISOString(),
        searchText: `${title}\n${body}`,
      } satisfies HistoryDocument;
    });
  } finally {
    database.close();
  }
}

function opencodeSource(
  source: OpenCodeSourceName,
  filePath: (paths: HistoryPaths) => string,
): HistorySource {
  return {
    name: source,
    label:
      source === "opencode-conductor"
        ? "OpenCode bundled with Conductor"
        : "OpenCode standalone",
    async scan(paths: HistoryPaths): Promise<HistorySourceResult> {
      const resolvedPath = filePath(paths);
      const files = (await pathExists(resolvedPath)) ? [resolvedPath] : [];
      return sourceResult(source, files, () =>
        opencodeDocuments(resolvedPath, source),
      );
    },
  };
}

export function createOpenCodeSources(): readonly HistorySource[] {
  return [
    opencodeSource("opencode-conductor", (paths) => paths.conductorOpenCodeDb),
    opencodeSource(
      "opencode-standalone",
      (paths) => paths.standaloneOpenCodeDb,
    ),
  ];
}
