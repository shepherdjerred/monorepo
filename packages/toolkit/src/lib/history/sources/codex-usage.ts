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
  // Codex has emitted per-turn usage under two different event shapes across
  // versions — the older top-level `token_usage_record` (`turn_token_usage`)
  // and the current `event_msg`-wrapped `token_count`
  // (`info.last_token_usage`) — and real rollouts can carry both for the
  // same turns. Tracked separately and merged by `mergeCodexUsageEvents`,
  // which keeps every event from both lists without double-counting a turn
  // reported in both formats.
  readonly tokenCountEvents: UsageEventEntry[];
  readonly tokenUsageRecordEvents: UsageEventEntry[];
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

/** `turn_context` (the current format) carries the active model directly. */
function applyTurnContext(
  accumulator: CodexRolloutAccumulator,
  payload: Record<string, unknown>,
): void {
  const model = stringValue(payload["model"]);
  if (model !== null) {
    accumulator.currentModel = model;
  }
}

function usageCounts(usage: Record<string, unknown>): UsageCounts {
  return {
    inputTokens: numberValue(usage["input_tokens"]),
    outputTokens: numberValue(usage["output_tokens"]),
    cacheReadTokens: 0,
    cacheCreationTokens: numberValue(usage["cache_write_input_tokens"]),
    cachedInputTokens: numberValue(usage["cached_input_tokens"]),
    reasoningTokens: numberValue(usage["reasoning_output_tokens"]),
  };
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
  const counts = usageCounts(usage);
  const model = accumulator.currentModel ?? "unknown";
  accumulator.tokenUsageRecordEvents.push(
    usageEventEntry(timestamp, model, counts, catalogCost([model], counts)),
  );
}

/**
 * The current rollout format's per-turn usage: an `event_msg` whose payload
 * type is `token_count`, with the turn's delta at `info.last_token_usage`
 * (the same shape as `turn_token_usage` above; `info.total_token_usage` is
 * the cumulative thread total, analogous to `thread_token_usage`, and isn't
 * used here for the same reason `thread_token_usage` isn't).
 */
function applyTokenCount(
  accumulator: CodexRolloutAccumulator,
  payload: Record<string, unknown>,
  timestamp: string | null,
): void {
  if (timestamp === null) {
    return;
  }
  const info = parseRecord(payload["info"]);
  const usage = info === null ? null : parseRecord(info["last_token_usage"]);
  if (usage === null) {
    return;
  }
  const counts = usageCounts(usage);
  const model = accumulator.currentModel ?? "unknown";
  accumulator.tokenCountEvents.push(
    usageEventEntry(timestamp, model, counts, catalogCost([model], counts)),
  );
}

/**
 * A line that fails to parse as JSON is truncated or corrupt — propagated
 * rather than skipped, so a partially-written rollout record doesn't
 * silently shrink this thread's usage on the next scan (the cumulative
 * `token_usage_record` this file is scanned for is exactly the kind of
 * record most likely to be mid-write when read). The error reports only the
 * file and line number, never the line's own content, since a corrupt
 * record can carry arbitrary session/tool data.
 */
function applyCodexRolloutLine(
  accumulator: CodexRolloutAccumulator,
  line: string,
  filePath: string,
  lineNumber: number,
): void {
  if (line.trim().length === 0) {
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(
      `Malformed Codex rollout line ${String(lineNumber)} in ${filePath}`,
      { cause: error },
    );
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
  } else if (type === "turn_context") {
    applyTurnContext(accumulator, payload);
  } else if (
    type === "event_msg" &&
    stringValue(payload["type"]) === "thread_settings_applied"
  ) {
    applyThreadSettings(accumulator, payload);
  } else if (
    type === "event_msg" &&
    stringValue(payload["type"]) === "token_count"
  ) {
    applyTokenCount(accumulator, payload, timestamp);
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
    tokenCountEvents: [],
    tokenUsageRecordEvents: [],
  };
  raw.split("\n").forEach((line, index) => {
    applyCodexRolloutLine(accumulator, line, filePath, index + 1);
  });
  return accumulator;
}

/**
 * A `token_count` event and a `token_usage_record` for the same turn report
 * identical token counts (verified against real rollout data — same
 * input/output/cached/reasoning numbers, logged moments apart under two
 * different event shapes), but not a shared id or timestamp to join on. This
 * signature of the actual counts is the join key: two events with the same
 * signature are almost certainly the same turn reported twice, while a
 * signature with no counterpart is a turn only one format captured (e.g. a
 * thread that started before a Codex version began dual-emitting).
 */
function usageSignature(counts: UsageCounts): string {
  return [
    counts.inputTokens,
    counts.outputTokens,
    counts.cacheCreationTokens,
    counts.cachedInputTokens,
    counts.reasoningTokens,
  ].join(":");
}

/**
 * Merges the two rollout usage formats without ever discarding a whole
 * format wholesale: every `token_usage_record` event is kept unconditionally
 * (it's never wrong to keep it), and a `token_count` event is added only when
 * it can't be matched one-for-one against a still-unconsumed
 * `token_usage_record` with the identical signature. A count of *remaining*
 * matches per signature (rather than a plain "have we seen this signature"
 * set) is required because two distinct, legitimate turns can share a
 * signature by coincidence (e.g. two short replies with the same token
 * counts) — a membership check would treat the second turn's `token_count`
 * event as a cross-format duplicate of the first and silently drop it, even
 * though only one, or neither, of the old-format entries actually
 * corresponds to it.
 */
function mergeCodexUsageEvents(
  accumulator: CodexRolloutAccumulator,
): UsageEventEntry[] {
  const availableMatches = new Map<string, number>();
  for (const event of accumulator.tokenUsageRecordEvents) {
    const signature = usageSignature(event);
    availableMatches.set(signature, (availableMatches.get(signature) ?? 0) + 1);
  }
  const merged = [...accumulator.tokenUsageRecordEvents];
  for (const event of accumulator.tokenCountEvents) {
    const signature = usageSignature(event);
    const remaining = availableMatches.get(signature) ?? 0;
    if (remaining > 0) {
      availableMatches.set(signature, remaining - 1);
    } else {
      merged.push(event);
    }
  }
  return merged;
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
    if (accumulator.threadId === null) {
      continue;
    }
    const events = mergeCodexUsageEvents(accumulator);
    if (events.length > 0) {
      result.set(accumulator.threadId, events);
    }
  }
  return result;
}
