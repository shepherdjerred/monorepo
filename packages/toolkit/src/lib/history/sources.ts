import { stat } from "node:fs/promises";
import path from "node:path";
import { createAntigravitySource } from "./sources/antigravity.ts";
import { createCodexSource } from "./sources/codex-scan.ts";
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
  diffFiles,
  filesUnder,
  firstText,
  incrementalResult,
  sourceReadResult,
  sourceResult,
  statFiles,
} from "./sources-shared.ts";
import { parseRecord, parseTimestamp, stringValue } from "./query/text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistoryScanOptions,
  HistorySource,
  HistorySourceReadResult,
  HistorySourceResult,
  UsageEventEntry,
} from "./types.ts";
import {
  catalogCost,
  optionalUsageNumber,
  requiredAbsoluteTimestamp,
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
 * `record.message` and `message.usage` being entirely absent is normal
 * (many record types, and non-assistant messages, never carry either);
 * either being *present* but not an object — or `message.usage` present
 * with a missing/non-string model — is malformed. Treating it the same as
 * "no usage" would silently drop that response's tokens/cost while the
 * scan reports success. The record's own `timestamp` is likewise validated
 * strictly here (never falling back to an epoch or file-mtime default the
 * way message indexing does), since a `--since` filter is only as
 * trustworthy as the timestamps stored on each usage event.
 */
function claudeUsageEntry(
  record: Record<string, unknown>,
  location: UsageFieldLocation,
): ClaudeUsageEntry | null {
  const messageValue = record["message"];
  if (messageValue === undefined) {
    return null;
  }
  const message = parseRecord(messageValue);
  if (message === null) {
    throw new Error(
      `Malformed Claude message container on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
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
  const occurredAt = requiredAbsoluteTimestamp(
    "Claude",
    typeof timestampValue === "string" ? timestampValue : null,
    "usage record",
    location,
  );
  return {
    occurredAt,
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

async function parseClaudeDocument(
  file: string,
  claudeProjects: string,
): Promise<HistoryDocument> {
  const transcript = await readClaudeTranscript(
    file,
    INDEXED_MESSAGE_PARSE_LIMIT,
  );
  const info = await stat(file);
  const fallback = new Date(info.mtimeMs).toISOString();
  const firstUser = openingPrompt(transcript.messages);
  return makeHistoryDocument(
    {
      source: "claude",
      sourceId: path.relative(claudeProjects, file),
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
  );
}

async function scanClaude(
  paths: HistoryPaths,
  previous: ReadonlyMap<string, string> | null,
  force: boolean,
): Promise<{
  readonly result: HistorySourceResult;
  readonly signatures: ReadonlyMap<string, string> | null;
}> {
  const files = await filesUnder(paths.claudeProjects, ".jsonl");
  if (files.length === 0) {
    return {
      result: await sourceResult("claude", files, () => []),
      signatures: new Map(),
    };
  }
  const { fingerprint, signatures } = await statFiles(files);
  const diff =
    force || previous === null ? null : diffFiles(previous, signatures);
  // A deletion falls back to a full re-parse: retiring one document while
  // trusting cached stats for the rest would strand a ghost id if a file
  // ever reappeared with identical mtime+size, and deletions are rare.
  const full = diff === null || diff.deleted.length > 0;
  const parseFiles = full ? files : [...diff.added, ...diff.changed].sort();
  try {
    const documents: HistoryDocument[] = [];
    for (const file of parseFiles) {
      documents.push(await parseClaudeDocument(file, paths.claudeProjects));
    }
    const sourceIds = files.map((file) =>
      path.relative(paths.claudeProjects, file),
    );
    // The cache holds pre-parse stats, so a file written mid-scan differs
    // on the next pass and its new content is parsed then.
    if (full) {
      return {
        result: {
          source: "claude",
          available: true,
          documents,
          fingerprint,
          error: null,
          complete: true,
          sourceIds,
        },
        signatures,
      };
    }
    return {
      result: incrementalResult("claude", documents, sourceIds, fingerprint),
      signatures,
    };
  } catch (error: unknown) {
    return {
      result: {
        source: "claude",
        available: false,
        documents: [],
        fingerprint,
        error: error instanceof Error ? error.message : String(error),
        complete: true,
        sourceIds: [],
      },
      // A failed scan commits nothing: the next pass retries every file
      // the cache does not already vouch for.
      signatures: null,
    };
  }
}

export function createClaudeSource(): HistorySource {
  let previous: ReadonlyMap<string, string> | null = null;
  return {
    name: "claude",
    label: "Claude Code",
    scan: async (paths: HistoryPaths, options?: HistoryScanOptions) => {
      const { result, signatures } = await scanClaude(
        paths,
        previous,
        options?.force ?? false,
      );
      if (signatures !== null) {
        previous = signatures;
      }
      return result;
    },
    read: readClaude,
  };
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
    createClaudeSource(),
    createCodexSource(),
    createCursorSource(),
    ...createOpenCodeSources(),
    createAntigravitySource(),
    createGrokSource(),
  ];
}
