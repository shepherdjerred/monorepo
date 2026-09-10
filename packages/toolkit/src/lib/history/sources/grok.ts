import { redactSecrets } from "@shepherdjerred/llm-observability/redact";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  makeHistoryDocument,
  openingPrompt,
} from "#lib/history/query/messages.ts";
import type { HistoryPaths } from "#lib/history/paths.ts";
import {
  filesUnder,
  firstText,
  pathExists,
  sourceReadResult,
  sourceResult,
} from "#lib/history/sources-shared.ts";
import {
  parseJsonLine,
  parseRecord,
  parseTimestamp,
  stringValue,
} from "#lib/history/query/text.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
  UsageEventEntry,
} from "#lib/history/types.ts";
import {
  reportedCost,
  usageEventEntry,
  type UsageCost,
  type UsageCounts,
} from "#lib/history/usage-cost.ts";

const TICKS_PER_USD = 1e10;

type GrokSessionParse = {
  readonly messages: HistoryMessage[];
  readonly usageEvents: UsageEventEntry[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

type GrokSessionMeta = {
  readonly sessionId: string | null;
  readonly cwd: string | null;
  readonly defaultModel: string | null;
};

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function grokReportedCost(ticksValue: unknown): UsageCost {
  const ticks = numberValue(ticksValue);
  return reportedCost(ticks > 0 ? ticks / TICKS_PER_USD : null);
}

function grokUsageCounts(usage: Record<string, unknown>): UsageCounts {
  return {
    inputTokens: numberValue(usage["inputTokens"]),
    outputTokens: numberValue(usage["outputTokens"]),
    cacheReadTokens: numberValue(usage["cachedReadTokens"]),
    cacheCreationTokens: numberValue(usage["cacheCreationTokens"]),
    cachedInputTokens: 0,
    reasoningTokens: numberValue(usage["reasoningTokens"]),
  };
}

/**
 * A `turn_completed` event's per-model `modelUsage` breakdown (when present)
 * carries each model's own `costUsdTicks`, so it's preferred over the
 * top-level usage/cost even for single-model turns. Reasoning tokens are
 * already included inside `outputTokens` here (unlike Claude Code), so they
 * are recorded for display only and never added on top. Every entry is
 * tagged with the turn's own timestamp rather than combined into one
 * whole-session total, so `--since` can filter to activity within a window
 * instead of attributing the whole session to wherever its last turn falls.
 */
function grokUsageEntries(
  usage: Record<string, unknown>,
  defaultModel: string,
  occurredAt: string,
): UsageEventEntry[] {
  const modelUsage = parseRecord(usage["modelUsage"]);
  if (modelUsage !== null && Object.keys(modelUsage).length > 0) {
    return Object.entries(modelUsage).flatMap(([model, value]) => {
      const modelRecord = parseRecord(value);
      if (modelRecord === null) {
        return [];
      }
      const counts = grokUsageCounts(modelRecord);
      return [
        usageEventEntry(
          occurredAt,
          model,
          counts,
          grokReportedCost(modelRecord["costUsdTicks"]),
        ),
      ];
    });
  }
  return [
    usageEventEntry(
      occurredAt,
      defaultModel,
      grokUsageCounts(usage),
      grokReportedCost(usage["costUsdTicks"]),
    ),
  ];
}

function grokContentText(update: Record<string, unknown>): string | null {
  const content = parseRecord(update["content"]);
  return content === null ? null : stringValue(content["text"]);
}

/**
 * A tool call's `rawInput` is an arbitrary, tool-defined object — it can
 * legitimately carry an env map, an Authorization header, or a token as one
 * of its fields. Redact it the same way command output is redacted before
 * being archived, rather than persisting it verbatim into the local FTS
 * index.
 */
function grokToolText(update: Record<string, unknown>): string {
  const title = stringValue(update["title"]) ?? "";
  const status = stringValue(update["status"]) ?? "";
  const rawInput = update["rawInput"];
  const parts = [title, status];
  if (rawInput !== undefined) {
    try {
      parts.push(JSON.stringify(redactSecrets(rawInput)));
    } catch {
      // Non-serializable rawInput (shouldn't happen for parsed JSON) — skip it.
    }
  }
  return parts.filter((part) => part.length > 0).join(" ");
}

function grokMessage(
  update: Record<string, unknown>,
  createdAt: string | null,
): HistoryMessage | null {
  const type = stringValue(update["sessionUpdate"]);
  if (type === "user_message_chunk") {
    const text = grokContentText(update);
    return text === null || text.length === 0
      ? null
      : { role: "user", text, createdAt };
  }
  if (type === "agent_message_chunk") {
    const text = grokContentText(update);
    return text === null || text.length === 0
      ? null
      : { role: "assistant", text, createdAt };
  }
  if (type === "tool_call" || type === "tool_call_update") {
    const text = grokToolText(update);
    return text.length === 0 ? null : { role: "tool", text, createdAt };
  }
  if (type === "session_recap") {
    const summary = stringValue(update["summary"]);
    return summary === null || summary.length === 0
      ? null
      : { role: "assistant", text: summary, createdAt };
  }
  // agent_thought_chunk (reasoning), hook_execution, task_backgrounded/completed,
  // plan, retry_state, image_compressed/dropped, current_mode_update,
  // compaction_checkpoint, auto_compact_started/completed — internal telemetry,
  // never indexed.
  return null;
}

type ParsedGrokLine = {
  readonly update: Record<string, unknown>;
  readonly timestamp: string | null;
};

function parseGrokLine(line: string): ParsedGrokLine | null {
  const record = parseRecord(parseJsonLine(line));
  if (record === null) {
    return null;
  }
  const params = parseRecord(record["params"]);
  if (params === null) {
    return null;
  }
  const update = parseRecord(params["update"]);
  if (update === null) {
    return null;
  }
  const timestampRaw = record["timestamp"];
  const timestamp =
    typeof timestampRaw === "number"
      ? parseTimestamp(timestampRaw, new Date(0))
      : null;
  return { update, timestamp };
}

async function readGrokSession(
  filePath: string,
  defaultModelHint: string | null,
): Promise<GrokSessionParse> {
  const raw = await Bun.file(filePath).text();
  const messages: HistoryMessage[] = [];
  const usageEvents: UsageEventEntry[] = [];
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = parseGrokLine(line);
    if (parsed === null) {
      continue;
    }
    if (parsed.timestamp !== null) {
      createdAt ??= parsed.timestamp;
      updatedAt = parsed.timestamp;
    }
    if (stringValue(parsed.update["sessionUpdate"]) === "turn_completed") {
      const usage = parseRecord(parsed.update["usage"]);
      if (usage !== null) {
        const occurredAt =
          parsed.timestamp ?? updatedAt ?? new Date(0).toISOString();
        usageEvents.push(
          ...grokUsageEntries(usage, defaultModelHint ?? "unknown", occurredAt),
        );
      }
      continue;
    }
    const message = grokMessage(parsed.update, parsed.timestamp);
    if (message !== null) {
      messages.push(message);
    }
  }
  return { messages, usageEvents, createdAt, updatedAt };
}

function urlDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function grokSessionMeta(updatesPath: string): Promise<GrokSessionMeta> {
  const summaryPath = path.join(path.dirname(updatesPath), "summary.json");
  if (!(await pathExists(summaryPath))) {
    return { sessionId: null, cwd: null, defaultModel: null };
  }
  const record = parseRecord(parseJsonLine(await Bun.file(summaryPath).text()));
  if (record === null) {
    return { sessionId: null, cwd: null, defaultModel: null };
  }
  const info = parseRecord(record["info"]);
  const sessionId = info === null ? null : stringValue(info["id"]);
  const cwd =
    (info === null ? null : stringValue(info["cwd"])) ??
    stringValue(record["git_root_dir"]);
  const defaultModel = stringValue(record["current_model_id"]);
  return { sessionId, cwd, defaultModel };
}

async function grokSessionFiles(grokHome: string): Promise<string[]> {
  const files = await filesUnder(grokHome, ".jsonl");
  return files.filter((file) => path.basename(file) === "updates.jsonl");
}

async function grokDocument(
  filePath: string,
  grokHome: string,
): Promise<HistoryDocument> {
  const meta = await grokSessionMeta(filePath);
  const parsed = await readGrokSession(filePath, meta.defaultModel);
  const info = await stat(filePath);
  const fallback = new Date(info.mtimeMs).toISOString();
  const sessionDir = path.dirname(filePath);
  const projectDir = path.dirname(sessionDir);
  const sessionId =
    meta.sessionId ?? urlDecodeSegment(path.basename(sessionDir));
  const workspace = meta.cwd ?? urlDecodeSegment(path.basename(projectDir));
  return makeHistoryDocument(
    {
      source: "grok",
      sourceId: path.relative(grokHome, filePath),
      title: firstText(
        openingPrompt(parsed.messages) ?? sessionId,
        "Grok session",
      ),
      path: filePath,
      workspace,
      agent: "Grok",
      createdAt: parsed.createdAt ?? fallback,
      updatedAt: parsed.updatedAt ?? fallback,
      runtimeId: sessionId,
      usageEvents: parsed.usageEvents,
    },
    parsed.messages,
  );
}

export function createGrokSource(): HistorySource {
  return {
    name: "grok",
    label: "Grok",
    async scan(paths: HistoryPaths) {
      const files = await grokSessionFiles(paths.grokHome);
      return sourceResult("grok", files, async () => {
        const documents: HistoryDocument[] = [];
        for (const file of files) {
          documents.push(await grokDocument(file, paths.grokHome));
        }
        return documents;
      });
    },
    async read(paths: HistoryPaths, records: readonly HistoryRecord[]) {
      return sourceReadResult(
        "grok",
        records.map((record) => record.sourceId),
        async () => {
          const messages = new Map<string, readonly HistoryMessage[]>();
          for (const record of records) {
            const filePath = path.join(paths.grokHome, record.sourceId);
            const parsed = await readGrokSession(filePath, null);
            messages.set(record.sourceId, parsed.messages);
          }
          return messages;
        },
      );
    },
  };
}
