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
import {
  parseJsonLine,
  parseRecord,
  parseTimestamp,
  stringValue,
} from "./query/text.ts";
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
};

type ClaudeTranscript = {
  readonly messages: readonly HistoryMessage[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly runtimeId: string | null;
  readonly usageEntries: readonly ClaudeUsageEntry[];
};

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
  };
}

async function readClaudeTranscript(
  file: string,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<ClaudeTranscript> {
  const raw = await Bun.file(file).text();
  const messages: HistoryMessage[] = [];
  const usageEntries: ClaudeUsageEntry[] = [];
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
    const parsedTimestamp =
      timestamp === null ? null : parseTimestamp(timestamp, new Date(0));
    if (parsedTimestamp !== null) {
      createdAt ??= parsedTimestamp;
      updatedAt = parsedTimestamp;
    }
    const usageEntry = claudeUsageEntry(record, parsedTimestamp);
    if (usageEntry !== null) {
      usageEntries.push(usageEntry);
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
