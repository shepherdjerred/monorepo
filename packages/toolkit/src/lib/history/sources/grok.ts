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
  requiredUsageNumber,
  usageEventEntry,
  type UsageCost,
  type UsageCounts,
  type UsageFieldLocation,
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

type GrokLineLocation = UsageFieldLocation;

function grokNumberField(
  usage: Record<string, unknown>,
  key: string,
  location: GrokLineLocation,
): number {
  return requiredUsageNumber("Grok", usage, key, location);
}

function grokReportedCost(
  usage: Record<string, unknown>,
  location: GrokLineLocation,
): UsageCost {
  const ticks = grokNumberField(usage, "costUsdTicks", location);
  return reportedCost(ticks > 0 ? ticks / TICKS_PER_USD : null);
}

function grokUsageCounts(
  usage: Record<string, unknown>,
  location: GrokLineLocation,
): UsageCounts {
  return {
    inputTokens: grokNumberField(usage, "inputTokens", location),
    outputTokens: grokNumberField(usage, "outputTokens", location),
    cacheReadTokens: grokNumberField(usage, "cachedReadTokens", location),
    cacheCreationTokens: grokNumberField(
      usage,
      "cacheCreationTokens",
      location,
    ),
    cachedInputTokens: 0,
    reasoningTokens: grokNumberField(usage, "reasoningTokens", location),
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
 *
 * A `modelUsage` entry that isn't an object is malformed data, not a
 * legitimate empty case — propagated as a scan failure (matching how a
 * corrupt JSONL line is handled elsewhere in this source) rather than
 * silently skipped, since a silent skip here would let the next successful
 * scan overwrite the last good index with an understated total that never
 * self-corrects.
 */
function grokUsageEntries(
  usage: Record<string, unknown>,
  defaultModel: string,
  occurredAt: string,
  location: GrokLineLocation,
): UsageEventEntry[] {
  const modelUsage = parseRecord(usage["modelUsage"]);
  if (modelUsage !== null && Object.keys(modelUsage).length > 0) {
    return Object.entries(modelUsage).map(([model, value]) => {
      const modelRecord = parseRecord(value);
      if (modelRecord === null) {
        throw new Error(
          `Malformed Grok model usage entry for model "${model}" on line ${String(location.lineNumber)} in ${location.filePath}`,
        );
      }
      return usageEventEntry(
        occurredAt,
        model,
        grokUsageCounts(modelRecord, location),
        grokReportedCost(modelRecord, location),
      );
    });
  }
  return [
    usageEventEntry(
      occurredAt,
      defaultModel,
      grokUsageCounts(usage, location),
      grokReportedCost(usage, location),
    ),
  ];
}

function grokContentText(update: Record<string, unknown>): string | null {
  const content = parseRecord(update["content"]);
  return content === null ? null : stringValue(content["text"]);
}

/**
 * `rawInput` is an arbitrary, tool-defined object — a shell command can
 * embed a credential in forms no fixed pattern set can fully enumerate
 * (Bearer tokens, `--user name:pass`, a `scheme://user:pass@host` URL, and
 * whatever else a future tool call happens to pass). `title`/`status` are
 * the tool's own fixed, low-cardinality metadata (e.g. "run shell command",
 * "completed") and carry no such risk, so only those are indexed; the free
 * -form `rawInput` itself is never persisted, rather than attempting to
 * pattern-match every way a secret could appear inside it.
 */
function grokToolText(update: Record<string, unknown>): string {
  const title = stringValue(update["title"]) ?? "";
  const status = stringValue(update["status"]) ?? "";
  return [title, status].filter((part) => part.length > 0).join(" ");
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

/**
 * A line that fails to parse as JSON is truncated or corrupt — propagated
 * rather than skipped, so a partially-written update doesn't quietly shrink
 * this session's usage on the next scan. A line that parses fine but doesn't
 * match the expected envelope shape is a legitimate message type this
 * adapter doesn't index (skipped, not an error). The error reports only the
 * file and line number, never the line's own content, since a corrupt
 * update can carry arbitrary tool/session data.
 */
function parseGrokLine(
  line: string,
  filePath: string,
  lineNumber: number,
): ParsedGrokLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(
      `Malformed Grok update line ${String(lineNumber)} in ${filePath}`,
      { cause: error },
    );
  }
  const record = parseRecord(value);
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
  const lines = raw.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = parseGrokLine(line, filePath, index + 1);
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
          ...grokUsageEntries(
            usage,
            defaultModelHint ?? "unknown",
            occurredAt,
            {
              filePath,
              lineNumber: index + 1,
            },
          ),
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
  const raw = await Bun.file(summaryPath).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Grok summary is malformed: ${summaryPath}`, {
      cause: error,
    });
  }
  const record = parseRecord(parsed);
  if (record === null) {
    throw new Error(`Grok summary is malformed: ${summaryPath}`);
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
