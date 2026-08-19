import {
  firstText,
  readDatabase,
  requireTables,
  rowValue,
  rows,
  RowSchema,
} from "./sources-shared.ts";
import { parseTimestamp, stringValue } from "./text.ts";
import type { HistoryDocument } from "./types.ts";

export function scanCodexCatalog(filePath: string): HistoryDocument[] {
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
      const threadId = String(rowValue(row, "thread_id"));
      return {
        source: "codex",
        sourceId: `${filePath}:${String(rowValue(row, "host_id"))}:${threadId}`,
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
        runtimeId: threadId,
        openingPromptHash: null,
        dialogueText: "",
        toolOutputText: [workspace, branch]
          .filter((value) => value !== null)
          .join("\n"),
      } satisfies HistoryDocument;
    });
  } finally {
    database.close();
  }
}
