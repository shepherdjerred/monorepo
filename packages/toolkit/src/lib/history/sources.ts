import { stat } from "node:fs/promises";
import path from "node:path";
import { createAntigravitySource } from "./sources/antigravity.ts";
import { createCodexSource } from "./sources/codex.ts";
import { createConductorSource } from "./sources/conductor.ts";
import { createCursorSource } from "./sources/cursor.ts";
import { createGrokSource } from "./sources/grok.ts";
import {
  historyMessageRole,
  INDEXED_MESSAGE_PARSE_LIMIT,
  makeHistoryDocument,
  openingPrompt,
  parseConversationEnvelope,
} from "./query/messages.ts";
import { createOpenCodeSources } from "./sources/opencode.ts";
import type { HistoryPaths } from "./paths.ts";
import {
  filesUnder,
  firstText,
  sourceReadResult,
  sourceResult,
} from "./sources-shared.ts";
import { parseRecord, parseTimestamp, stringValue } from "./query/text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
  HistorySourceReadResult,
  HistorySourceResult,
  UsageEventEntry,
} from "./types.ts";
import {
  catalogCost,
  usageEventEntry,
  type UsageCounts,
} from "./usage-cost.ts";

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type ClaudeUsageEntry = {
  readonly occurredAt: string | null;
  readonly model: string;
  readonly usage: UsageCounts;
  readonly messageId: string | null;
};

type ClaudeTranscript = {
  readonly messages: readonly HistoryMessage[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly runtimeId: string | null;
  readonly usageEntries: readonly ClaudeUsageEntry[];
};

/**
 * When one API response has multiple content blocks (text, thinking,
 * tool_use), Claude Code can log them as separate JSONL records that each
 * repeat that response's full `message.usage` snapshot. `message.id` (the
 * Anthropic API response id) is shared by every such record, so it's the
 * dedup key — without it, summing every record's usage would count the same
 * response's tokens once per content block instead of once per response.
 */
function claudeUsageEntry(
  record: Record<string, unknown>,
  occurredAt: string | null,
): ClaudeUsageEntry | null {
  const message = parseRecord(record["message"]);
  if (message === null) {
    return null;
  }
  const usage = parseRecord(message["usage"]);
  const model = stringValue(message["model"]);
  if (usage === null || model === null) {
    return null;
  }
  return {
    occurredAt,
    model,
    usage: {
      inputTokens: numberValue(usage["input_tokens"]),
      outputTokens: numberValue(usage["output_tokens"]),
      cacheReadTokens: numberValue(usage["cache_read_input_tokens"]),
      cacheCreationTokens: numberValue(usage["cache_creation_input_tokens"]),
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
    messageId: stringValue(message["id"]),
  };
}

/**
 * A line that fails to parse as JSON is truncated or corrupt — propagated
 * rather than skipped, so a partially-written transcript record (especially
 * an assistant record carrying `message.usage`) doesn't quietly shrink this
 * session's usage on the next scan while the scan still reports success. The
 * error reports only the file and line number, never the line's own
 * content, since a corrupt record can carry arbitrary conversation data.
 */
function parseClaudeLine(
  line: string,
  filePath: string,
  lineNumber: number,
): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(
      `Malformed Claude transcript line ${String(lineNumber)} in ${filePath}`,
      { cause: error },
    );
  }
}

async function readClaudeTranscript(
  file: string,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<ClaudeTranscript> {
  const raw = await Bun.file(file).text();
  const messages: HistoryMessage[] = [];
  const usageEntriesById = new Map<string, ClaudeUsageEntry>();
  const usageEntriesWithoutId: ClaudeUsageEntry[] = [];
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let runtimeId: string | null = null;
  const lines = raw.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    const value = parseClaudeLine(line, file, index + 1);
    const record = parseRecord(value);
    if (record === null) {
      continue;
    }
    runtimeId ??=
      stringValue(record["sessionId"]) ?? stringValue(record["session_id"]);
    const timestamp = stringValue(record["timestamp"]);
    const parsedTimestamp =
      timestamp === null ? null : parseTimestamp(timestamp, new Date(0));
    if (parsedTimestamp !== null) {
      createdAt ??= parsedTimestamp;
      updatedAt = parsedTimestamp;
    }
    const usageEntry = claudeUsageEntry(record, parsedTimestamp);
    if (usageEntry !== null) {
      // Claude Code repeats a growing cumulative snapshot across every
      // record sharing one response's `message.id` as its content blocks
      // stream in — the LAST one seen is the final, authoritative total, so
      // a later record for the same id replaces an earlier one rather than
      // being dropped.
      if (usageEntry.messageId === null) {
        usageEntriesWithoutId.push(usageEntry);
      } else {
        usageEntriesById.set(usageEntry.messageId, usageEntry);
      }
    }
    messages.push(
      ...parseConversationEnvelope(
        value,
        historyMessageRole(record["type"]),
        parsedTimestamp,
        maxCharacters,
      ),
    );
  }
  const usageEntries = [...usageEntriesWithoutId, ...usageEntriesById.values()];
  return { messages, createdAt, updatedAt, runtimeId, usageEntries };
}

function claudeUsageEvents(
  entries: readonly ClaudeUsageEntry[],
  fallbackOccurredAt: string,
): UsageEventEntry[] {
  return entries.map((entry) =>
    usageEventEntry(
      entry.occurredAt ?? fallbackOccurredAt,
      entry.model,
      entry.usage,
      catalogCost([entry.model], entry.usage),
    ),
  );
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
            usageEvents: claudeUsageEvents(transcript.usageEntries, fallback),
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

export function createHistorySources(): readonly HistorySource[] {
  return [
    createConductorSource(),
    {
      name: "claude",
      label: "Claude Code",
      scan: scanClaude,
      read: readClaude,
    },
    createCodexSource(),
    createCursorSource(),
    ...createOpenCodeSources(),
    createAntigravitySource(),
    createGrokSource(),
  ];
}
