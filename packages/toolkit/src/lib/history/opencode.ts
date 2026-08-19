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
  readDatabase,
  requireTables,
  rowValue,
  rows,
  RowSchema,
  sourceReadResult,
  sourceResult,
} from "./sources-shared.ts";
import {
  cleanText,
  extractText,
  parseJsonLine,
  parseRecord,
  stringValue,
} from "./text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryMessageRole,
  HistoryRecord,
  HistorySource,
  HistorySourceResult,
} from "./types.ts";

type OpenCodeSourceName = "opencode-conductor" | "opencode-standalone";

const OMITTED_PART_TYPES = new Set([
  "reasoning",
  "snapshot",
  "step-finish",
  "step-start",
]);

function messageRole(value: unknown): HistoryMessageRole {
  switch (value) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "tool":
      return "tool";
    default:
      return "unknown";
  }
}

function textMessage(
  role: HistoryMessageRole,
  value: unknown,
  createdAt: string | null,
  maxCharacters: number,
): HistoryMessage | null {
  const text = cleanText(extractText(value, 0, maxCharacters));
  return text.length === 0 ? null : { role, text, createdAt };
}

function chronologicalMessages(
  messages: readonly HistoryMessage[],
): HistoryMessage[] {
  return messages
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftTimestamp =
        left.entry.createdAt === null
          ? Number.MAX_SAFE_INTEGER
          : Date.parse(left.entry.createdAt);
      const rightTimestamp =
        right.entry.createdAt === null
          ? Number.MAX_SAFE_INTEGER
          : Date.parse(right.entry.createdAt);
      return leftTimestamp - rightTimestamp || left.index - right.index;
    })
    .map(({ entry }) => entry);
}

type OpenCodeData = {
  readonly documents: readonly HistoryDocument[];
  readonly messages: ReadonlyMap<string, readonly HistoryMessage[]>;
};

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function selectedValues(selected: ReadonlySet<string> | null): string[] {
  return selected === null ? [] : [...selected];
}

function sessionSelection(selected: ReadonlySet<string> | null): string {
  return selected === null
    ? ""
    : ` WHERE id IN (${placeholders(selected.size)})`;
}

function readOpenCodeData(
  filePath: string,
  source: OpenCodeSourceName,
  selected: ReadonlySet<string> | null = null,
  maxCharacters = Number.POSITIVE_INFINITY,
): OpenCodeData {
  const database = readDatabase(filePath);
  try {
    requireTables(database, "OpenCode", ["session", "message", "part"]);
    const sessionRows = rows(
      database,
      `SELECT id, title, directory, agent, model, time_created, time_updated
         FROM session${sessionSelection(selected)}`,
      RowSchema,
      selectedValues(selected),
    );
    const selectedIds = new Set(
      sessionRows.map((row) => String(rowValue(row, "id"))),
    );
    if (selectedIds.size === 0) {
      return { documents: [], messages: new Map() };
    }
    const messageRows = rows(
      database,
      `SELECT id, session_id, data, time_created FROM message
        WHERE session_id IN (${placeholders(selectedIds.size)})
        ORDER BY session_id, time_created, id`,
      RowSchema,
      [...selectedIds],
    );
    const selectedMessageIds = new Set(
      messageRows.map((row) => String(rowValue(row, "id"))),
    );
    const partRows = rows(
      database,
      `SELECT message_id, data, time_created FROM part
        WHERE message_id IN (${placeholders(selectedMessageIds.size)})
        ORDER BY message_id, time_created, id`,
      RowSchema,
      [...selectedMessageIds],
    );
    const messageMetadata = new Map<
      string,
      { readonly sessionId: string; readonly role: HistoryMessageRole }
    >();
    const messagesBySession = new Map<string, HistoryMessage[]>(
      [...selectedIds].map((sessionId) => [sessionId, []]),
    );

    for (const row of messageRows) {
      const messageId = String(rowValue(row, "id"));
      const sessionId = String(rowValue(row, "session_id"));
      const data = parseRecord(parseJsonLine(String(rowValue(row, "data"))));
      const role = messageRole(data?.["role"]);
      messageMetadata.set(messageId, { sessionId, role });
      const createdAt = new Date(
        Number(rowValue(row, "time_created")),
      ).toISOString();
      const parsed = textMessage(
        role,
        data?.["text"] ?? data?.["content"],
        createdAt,
        maxCharacters,
      );
      if (parsed !== null) {
        const existing = messagesBySession.get(sessionId) ?? [];
        existing.push(parsed);
        messagesBySession.set(sessionId, existing);
      }
    }

    for (const row of partRows) {
      const metadata = messageMetadata.get(String(rowValue(row, "message_id")));
      if (metadata === undefined) {
        continue;
      }
      const data = parseRecord(parseJsonLine(String(rowValue(row, "data"))));
      const partType = stringValue(data?.["type"]);
      if (partType !== null && OMITTED_PART_TYPES.has(partType)) {
        continue;
      }
      const role = partType === "tool" ? "tool" : metadata.role;
      const createdAt = new Date(
        Number(rowValue(row, "time_created")),
      ).toISOString();
      const parsed = textMessage(role, data, createdAt, maxCharacters);
      if (parsed !== null) {
        const existing = messagesBySession.get(metadata.sessionId) ?? [];
        existing.push(parsed);
        messagesBySession.set(metadata.sessionId, existing);
      }
    }

    for (const [sessionId, messages] of messagesBySession) {
      messagesBySession.set(sessionId, chronologicalMessages(messages));
    }

    const documents = sessionRows.map((row) => {
      const sessionId = String(rowValue(row, "id"));
      const title = stringValue(rowValue(row, "title")) ?? "OpenCode session";
      const messages = messagesBySession.get(sessionId) ?? [];
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
        runtimeId: sessionId,
        openingPromptHash: openingPromptHash(openingPrompt(messages)),
        dialogueText: dialogueText(messages),
        toolOutputText: toolOutputText(messages),
      } satisfies HistoryDocument;
    });
    return { documents, messages: messagesBySession };
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
      return sourceResult(
        source,
        files,
        () =>
          readOpenCodeData(
            resolvedPath,
            source,
            null,
            INDEXED_MESSAGE_PARSE_LIMIT,
          ).documents,
      );
    },
    async read(paths: HistoryPaths, records: readonly HistoryRecord[]) {
      const requestedSourceIds = records.map((record) => record.sourceId);
      return sourceReadResult(
        source,
        requestedSourceIds,
        () =>
          readOpenCodeData(filePath(paths), source, new Set(requestedSourceIds))
            .messages,
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
