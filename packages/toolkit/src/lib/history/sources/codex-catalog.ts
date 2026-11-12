import {
  firstText,
  readImmutableDatabase,
  requireTables,
  rowValue,
  rows,
  RowSchema,
} from "#lib/history/sources-shared.ts";
import { documentDetails } from "#lib/history/query/messages.ts";
import { parseTimestamp, stringValue } from "#lib/history/query/text.ts";
import type { HistoryDocument, HistoryMessage } from "#lib/history/types.ts";

/**
 * Session detail shows a catalog entry's metadata (title, workspace,
 * branch) as one tool message after the thread's own messages, so search
 * excerpts can quote it. Indexed message counts are derived from this same
 * message so `/v1/sessions` agrees with the detail reader.
 */
export function codexCatalogMessages(
  document:
    Pick<HistoryDocument, "title" | "toolOutputText" | "updatedAt"> | undefined,
): readonly HistoryMessage[] {
  if (document === undefined) {
    return [];
  }
  const text = [document.title, document.toolOutputText]
    .filter((part) => part.length > 0)
    .join("\n");
  return [{ role: "tool", text, createdAt: document.updatedAt }];
}

export async function scanCodexCatalog(
  filePath: string,
): Promise<HistoryDocument[]> {
  const database = await readImmutableDatabase(filePath, "Codex catalog");
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
      const metadata = {
        source: "codex" as const,
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
        usageEvents: [],
      };
      return {
        ...metadata,
        ...documentDetails(codexCatalogMessages(metadata), branch),
      } satisfies HistoryDocument;
    });
  } finally {
    database.close();
  }
}
