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
  optionalUsageNumber,
  requiredUsageNumber,
  usageEventEntry,
  type UsageCounts,
  type UsageFieldLocation,
} from "./usage-cost.ts";

type ClaudeUsageEntry = {
  readonly occurredAt: string;
  readonly model: string;
  readonly usage: UsageCounts;
  readonly messageId: string;
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
 * response's tokens once per content block instead of once per response,
 * which is why a usage-bearing record without one is rejected rather than
 * accumulated as if it were unique.
 *
 * `message.usage` being entirely absent is normal (e.g. a user-role record
 * never carries usage); `message.usage` being *present* but not an object,
 * or present with a missing/non-string model, is malformed — treating it
 * the same as "no usage" would silently drop that response's tokens/cost
 * while the scan reports success. The record's own `timestamp` is likewise
 * validated strictly here (never falling back to an epoch or file-mtime
 * default the way message indexing does), since a `--since` filter is only
 * as trustworthy as the timestamps stored on each usage event.
 */
function claudeUsageEntry(
  record: Record<string, unknown>,
  location: UsageFieldLocation,
): ClaudeUsageEntry | null {
  const message = parseRecord(record["message"]);
  if (message === null) {
    return null;
  }
  const usageValue = message["usage"];
  if (usageValue === undefined) {
    return null;
  }
  const usage = parseRecord(usageValue);
  const model = stringValue(message["model"]);
  if (usage === null || model === null) {
    throw new Error(
      `Malformed Claude usage container on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const messageId = stringValue(message["id"]);
  if (messageId === null) {
    throw new Error(
      `Claude usage record missing its response id on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const timestampValue = record["timestamp"];
  const parsedTimestamp =
    typeof timestampValue === "string"
      ? Date.parse(timestampValue)
      : Number.NaN;
  if (Number.isNaN(parsedTimestamp)) {
    throw new TypeError(
      `Claude usage record missing a valid timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return {
    occurredAt: new Date(parsedTimestamp).toISOString(),
    model,
    messageId,
    usage: {
      inputTokens: requiredUsageNumber(
        "Claude",
        usage,
        "input_tokens",
        location,
      ),
      outputTokens: requiredUsageNumber(
        "Claude",
        usage,
        "output_tokens",
        location,
      ),
      cacheReadTokens: optionalUsageNumber(
        "Claude",
        usage,
        "cache_read_input_tokens",
        location,
      ),
      cacheCreationTokens: optionalUsageNumber(
        "Claude",
        usage,
        "cache_creation_input_tokens",
        location,
      ),
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
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
    const usageEntry = claudeUsageEntry(record, {
      filePath: file,
      lineNumber: index + 1,
    });
    if (usageEntry !== null) {
      // Claude Code repeats a growing cumulative snapshot across every
      // record sharing one response's `message.id` as its content blocks
      // stream in — the LAST one seen is the final, authoritative total, so
      // a later record for the same id replaces an earlier one rather than
      // being dropped.
      usageEntriesById.set(usageEntry.messageId, usageEntry);
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
  const usageEntries = [...usageEntriesById.values()];
  return { messages, createdAt, updatedAt, runtimeId, usageEntries };
}

function claudeUsageEvents(
  entries: readonly ClaudeUsageEntry[],
): UsageEventEntry[] {
  return entries.map((entry) =>
    usageEventEntry(
      entry.occurredAt,
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
            usageEvents: claudeUsageEvents(transcript.usageEntries),
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
