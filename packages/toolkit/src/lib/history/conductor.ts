import type { Database } from "bun:sqlite";
import {
  historyMessageRole,
  INDEXED_MESSAGE_PARSE_LIMIT,
  makeHistoryDocument,
  parseConversationEnvelope,
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
import { parseJsonLine, parseTimestamp, stringValue } from "./text.ts";
import type {
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

function conductorMessages(
  database: Database,
  sessionIds: readonly string[],
  maxCharacters = Number.POSITIVE_INFINITY,
): ReadonlyMap<string, readonly HistoryMessage[]> {
  if (sessionIds.length === 0) {
    return new Map();
  }
  const messages = new Map<string, HistoryMessage[]>(
    sessionIds.map((sessionId) => [sessionId, []]),
  );
  for (const batch of batches(sessionIds)) {
    const messageRows = rows(
      database,
      `SELECT id, session_id, length(COALESCE(content, full_message, '')) AS content_length
         FROM session_messages
        WHERE session_id IN (${placeholders(batch.length)})
        ORDER BY session_id, created_at, id`,
      RowSchema,
      batch,
    );
    const readMessage = database.prepare(
      `SELECT role, content, full_message, created_at
         FROM session_messages WHERE id = ?`,
    );
    const readBoundedMessage = database.prepare(
      `WITH selected AS (
         SELECT role, created_at, COALESCE(content, full_message, '') AS raw
           FROM session_messages WHERE id = ?
       )
       SELECT role, created_at,
              CASE WHEN json_valid(raw)
                   THEN json_extract(raw, '$.type')
                   ELSE NULL END AS envelope_type,
              CASE WHEN json_valid(raw)
                   THEN json_extract(raw, '$.message.role')
                   ELSE NULL END AS nested_role,
              NULL AS block_type,
              CASE WHEN json_valid(raw)
                   THEN CASE WHEN json_type(raw, '$.message.content') = 'array'
                        THEN (
                          SELECT json_object(
                            'type', json_extract(raw, '$.type'),
                            'message', json_object(
                              'role', json_extract(raw, '$.message.role'),
                              'content', json(json_group_array(json_object(
                                'type', CASE WHEN block.type = 'object'
                                             THEN json_extract(block.value, '$.type')
                                             ELSE NULL END,
                                'text', substr(
                                  CASE WHEN block.type = 'object'
                                       THEN COALESCE(
                                         json_extract(block.value, '$.text'),
                                         json_extract(block.value, '$.content'),
                                         json_extract(block.value, '$.input.command'),
                                         json_extract(block.value, '$.name'),
                                         ''
                                       )
                                       ELSE CAST(block.value AS TEXT) END,
                                  1,
                                  max(1, CAST(? / max((
                                    SELECT count(*)
                                      FROM json_each(raw, '$.message.content')
                                  ), 1) AS INTEGER))
                                )
                              )))
                            )
                          )
                            FROM json_each(raw, '$.message.content') AS block
                        )
                        ELSE NULL END
                   ELSE NULL END AS bounded_envelope,
              substr(
                CASE WHEN json_valid(raw)
                     THEN COALESCE(
                       json_extract(raw, '$.message.text'),
                       CASE WHEN json_type(raw, '$.message.content') = 'text'
                            THEN json_extract(raw, '$.message.content')
                            ELSE NULL END,
                       json_extract(raw, '$.text'),
                       CASE WHEN json_type(raw, '$.content') = 'text'
                            THEN json_extract(raw, '$.content')
                            ELSE '' END
                     )
                     ELSE raw END,
                1, ?
              ) AS indexed_text
         FROM selected`,
    );
    for (const metadata of messageRows) {
      const sessionId = String(rowValue(metadata, "session_id"));
      const contentLength = Number(rowValue(metadata, "content_length"));
      const messageId = String(rowValue(metadata, "id"));
      const bounded =
        Number.isFinite(maxCharacters) && contentLength > maxCharacters * 4;
      const row = RowSchema.parse(
        bounded
          ? readBoundedMessage.get(messageId, maxCharacters, maxCharacters)
          : readMessage.get(messageId),
      );
      const raw =
        stringValue(rowValue(row, "content")) ??
        stringValue(rowValue(row, "full_message"));
      const indexedText = stringValue(rowValue(row, "indexed_text"));
      const boundedEnvelope = stringValue(rowValue(row, "bounded_envelope"));
      if (raw === null && indexedText === null && boundedEnvelope === null) {
        continue;
      }
      const timestamp = stringValue(rowValue(row, "created_at"));
      const blockType = stringValue(rowValue(row, "block_type"));
      const envelopeType = stringValue(rowValue(row, "envelope_type"));
      const nestedRole = stringValue(rowValue(row, "nested_role"));
      const parsed =
        raw === null
          ? (parseJsonLine(boundedEnvelope ?? "") ?? {
              type: envelopeType,
              message: {
                role: nestedRole,
                content:
                  blockType === null
                    ? indexedText
                    : [{ type: blockType, text: indexedText }],
              },
            })
          : (parseJsonLine(raw) ?? raw);
      const entries = parseConversationEnvelope(
        parsed,
        historyMessageRole(rowValue(row, "role")),
        timestamp === null ? null : parseTimestamp(timestamp, new Date(0)),
        maxCharacters,
      );
      const existing = messages.get(sessionId) ?? [];
      existing.push(...entries);
      messages.set(sessionId, existing);
    }
  }
  return messages;
}

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
        `SELECT id, title, created_at, updated_at, model, agent_type, workspace_id
           FROM sessions`,
        RowSchema,
      );
      const sessionIds = sessionRows.map((row) => String(rowValue(row, "id")));
      const messages = conductorMessages(
        database,
        sessionIds,
        INDEXED_MESSAGE_PARSE_LIMIT,
      );
      return sessionRows.map((row) => {
        const sourceId = String(rowValue(row, "id"));
        const title = stringValue(rowValue(row, "title")) ?? "Untitled";
        const createdAt = parseTimestamp(
          rowValue(row, "created_at"),
          new Date(0),
        );
        return makeHistoryDocument(
          {
            source: "conductor",
            sourceId,
            title: firstText(title, "Conductor session"),
            path: paths.conductorDb,
            workspace: stringValue(rowValue(row, "workspace_id")),
            agent:
              stringValue(rowValue(row, "agent_type")) ??
              stringValue(rowValue(row, "model")),
            createdAt,
            updatedAt: parseTimestamp(rowValue(row, "updated_at"), new Date(0)),
            runtimeId: sourceId,
          },
          messages.get(sourceId) ?? [],
        );
      });
    } finally {
      database.close();
    }
  });
}

async function readConductor(
  paths: HistoryPaths,
  records: readonly HistoryRecord[],
): Promise<HistorySourceReadResult> {
  const requestedSourceIds = records.map((record) => record.sourceId);
  return sourceReadResult("conductor", requestedSourceIds, () => {
    const database = readDatabase(paths.conductorDb);
    try {
      requireTables(database, "Conductor", ["sessions", "session_messages"]);
      const existingIds = batches(requestedSourceIds).flatMap((batch) =>
        rows(
          database,
          `SELECT id FROM sessions WHERE id IN (${placeholders(batch.length)})`,
          RowSchema,
          batch,
        ).map((row) => String(rowValue(row, "id"))),
      );
      return conductorMessages(database, existingIds);
    } finally {
      database.close();
    }
  });
}

export function createConductorSource(): HistorySource {
  return {
    name: "conductor",
    label: "Conductor",
    scan: scanConductor,
    read: readConductor,
  };
}
