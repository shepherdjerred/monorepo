import { filesUnder } from "@shepherdjerred/toolkit/lib/history/sources-shared.ts";
import {
  parseRecord,
  stringValue,
} from "@shepherdjerred/toolkit/lib/history/query/text.ts";
import type { UsageEventEntry } from "@shepherdjerred/toolkit/lib/history/types.ts";
import {
  catalogCost,
  usageEventEntry,
  type UsageCounts,
} from "@shepherdjerred/toolkit/lib/history/usage-cost.ts";

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type CodexRolloutAccumulator = {
  threadId: string | null;
  currentModel: string | null;
  readonly events: UsageEventEntry[];
};

function applySessionMeta(
  accumulator: CodexRolloutAccumulator,
  payload: Record<string, unknown>,
): void {
  accumulator.threadId ??=
    stringValue(payload["session_id"]) ?? stringValue(payload["id"]);
}

function applyThreadSettings(
  accumulator: CodexRolloutAccumulator,
  payload: Record<string, unknown>,
): void {
  const settings = parseRecord(payload["thread_settings"]);
  const model = settings === null ? null : stringValue(settings["model"]);
  if (model !== null) {
    accumulator.currentModel = model;
  }
}

/**
 * `turn_token_usage` (unlike `thread_token_usage`, a running cumulative
 * total for the whole thread) is the delta for just this turn, so each
 * record becomes its own timestamped event rather than one whole-thread
 * total — required for `--since` to filter to activity within a window
 * instead of attributing an old thread's entire lifetime usage to whichever
 * window its most recent turn happens to land in. `cached_input_tokens` is
 * OpenAI subset semantics (already included in `input_tokens`), so it's kept
 * separate from the Anthropic-style additive `cacheReadTokens` field.
 */
function applyTokenUsageRecord(
  accumulator: CodexRolloutAccumulator,
  payload: Record<string, unknown>,
  timestamp: string | null,
): void {
  if (timestamp === null) {
    return;
  }
  const usage = parseRecord(payload["turn_token_usage"]);
  if (usage === null) {
    return;
  }
  const counts: UsageCounts = {
    inputTokens: numberValue(usage["input_tokens"]),
    outputTokens: numberValue(usage["output_tokens"]),
    cacheReadTokens: 0,
    cacheCreationTokens: numberValue(usage["cache_write_input_tokens"]),
    cachedInputTokens: numberValue(usage["cached_input_tokens"]),
    reasoningTokens: numberValue(usage["reasoning_output_tokens"]),
  };
  const model = accumulator.currentModel ?? "unknown";
  accumulator.events.push(
    usageEventEntry(timestamp, model, counts, catalogCost([model], counts)),
  );
}

/**
 * A line that fails to parse as JSON is truncated or corrupt — propagated
 * rather than skipped, so a partially-written rollout record doesn't
 * silently shrink this thread's usage on the next scan (the cumulative
 * `token_usage_record` this file is scanned for is exactly the kind of
 * record most likely to be mid-write when read).
 */
function applyCodexRolloutLine(
  accumulator: CodexRolloutAccumulator,
  line: string,
): void {
  if (line.trim().length === 0) {
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(`Malformed Codex rollout line: ${line.slice(0, 200)}`, {
      cause: error,
    });
  }
  const record = parseRecord(value);
  if (record === null) {
    return;
  }
  const payload = parseRecord(record["payload"]);
  if (payload === null) {
    return;
  }
  const type = stringValue(record["type"]);
  const timestamp = stringValue(record["timestamp"]);
  if (type === "session_meta") {
    applySessionMeta(accumulator, payload);
  } else if (
    type === "event_msg" &&
    stringValue(payload["type"]) === "thread_settings_applied"
  ) {
    applyThreadSettings(accumulator, payload);
  } else if (type === "token_usage_record") {
    applyTokenUsageRecord(accumulator, payload, timestamp);
  }
}

async function parseCodexRolloutFile(
  filePath: string,
): Promise<CodexRolloutAccumulator> {
  const raw = await Bun.file(filePath).text();
  const accumulator: CodexRolloutAccumulator = {
    threadId: null,
    currentModel: null,
    events: [],
  };
  for (const line of raw.split("\n")) {
    applyCodexRolloutLine(accumulator, line);
  }
  return accumulator;
}

/**
 * Codex's `~/.codex/sessions/**\/*.jsonl` rollout files are a completely
 * separate tree from the `thread_history_*.sqlite` files used for search
 * (which carry no usage data at all) — but their filename UUID is the same
 * value as `thread_id` in those databases, so usage can be joined back onto
 * the documents built from them.
 */
export async function scanCodexSessionUsage(
  sessionsDir: string,
): Promise<ReadonlyMap<string, readonly UsageEventEntry[]>> {
  const files = await filesUnder(sessionsDir, ".jsonl");
  const result = new Map<string, readonly UsageEventEntry[]>();
  for (const file of files) {
    const accumulator = await parseCodexRolloutFile(file);
    if (accumulator.threadId === null || accumulator.events.length === 0) {
      continue;
    }
    result.set(accumulator.threadId, accumulator.events);
  }
  return result;
}
