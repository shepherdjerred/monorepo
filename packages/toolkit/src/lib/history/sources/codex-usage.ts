import { filesUnder } from "@shepherdjerred/toolkit/lib/history/sources-shared.ts";
import {
  parseRecord,
  stringValue,
} from "@shepherdjerred/toolkit/lib/history/query/text.ts";
import type { UsageEventEntry } from "@shepherdjerred/toolkit/lib/history/types.ts";
import {
  catalogCost,
  optionalUsageNumber,
  requiredUsageNumber,
  usageEventEntry,
  type UsageCounts,
  type UsageFieldLocation,
} from "@shepherdjerred/toolkit/lib/history/usage-cost.ts";

type CodexRolloutAccumulator = {
  threadId: string | null;
  currentModel: string | null;
  // Codex has emitted per-turn usage under two different event shapes across
  // versions — the older top-level `token_usage_record` (`turn_token_usage`)
  // and the current `event_msg`-wrapped `token_count`
  // (`info.last_token_usage`). A single rollout file is written by one Codex
  // process invocation running one build for its entire lifetime — a version
  // upgrade takes effect only on the next launch, which starts a new rollout
  // file (new thread id) rather than switching formats mid-file. Inspecting
  // every local rollout file on this machine (822 files spanning over a
  // month) confirms this: none contain `token_usage_record` at all, and no
  // file mixes the two shapes. The two lists are therefore never merged
  // per-turn — `scanCodexSessionUsage` picks whichever one is non-empty. A
  // per-turn join keyed on the token counts themselves (tried in two earlier
  // passes: a signature set, then a one-for-one multiset) was reliably
  // broken by the one thing count-equality can never rule out — two
  // different turns that happen to report identical counts — since there is
  // no shared id or timestamp between the formats to join on instead.
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

function usageCounts(
  usage: Record<string, unknown>,
  location: UsageFieldLocation,
): UsageCounts {
  return {
    inputTokens: requiredUsageNumber("Codex", usage, "input_tokens", location),
    outputTokens: requiredUsageNumber(
      "Codex",
      usage,
      "output_tokens",
      location,
    ),
    cacheReadTokens: 0,
    cacheCreationTokens: optionalUsageNumber(
      "Codex",
      usage,
      "cache_write_input_tokens",
      location,
    ),
    cachedInputTokens: optionalUsageNumber(
      "Codex",
      usage,
      "cached_input_tokens",
      location,
    ),
    reasoningTokens: optionalUsageNumber(
      "Codex",
      usage,
      "reasoning_output_tokens",
      location,
    ),
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
  location: UsageFieldLocation,
): void {
  const usage = parseRecord(payload["turn_token_usage"]);
  if (usage === null) {
    return;
  }
  if (timestamp === null) {
    throw new Error(
      `Codex token_usage_record missing its timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const counts = usageCounts(usage, location);
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
  location: UsageFieldLocation,
): void {
  const info = parseRecord(payload["info"]);
  const usage = info === null ? null : parseRecord(info["last_token_usage"]);
  if (usage === null) {
    return;
  }
  if (timestamp === null) {
    throw new Error(
      `Codex token_count event missing its timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const counts = usageCounts(usage, location);
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
  const location: UsageFieldLocation = { filePath, lineNumber };
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
    applyTokenCount(accumulator, payload, timestamp, location);
  } else if (type === "token_usage_record") {
    applyTokenUsageRecord(accumulator, payload, timestamp, location);
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
 * Selects whichever rollout usage format this file actually used, instead of
 * attempting a per-turn merge across the two lists. Both formats' events are
 * timestamped and shaped identically (see `usageCounts`), so nothing is lost
 * by this choice as long as the file-format-exclusivity invariant documented
 * on `CodexRolloutAccumulator` holds — and unlike a per-turn join keyed on
 * token counts, this never risks treating two distinct turns that happen to
 * report identical counts as the same turn reported twice.
 */
function selectCodexUsageEvents(
  accumulator: CodexRolloutAccumulator,
): UsageEventEntry[] {
  return accumulator.tokenCountEvents.length > 0
    ? accumulator.tokenCountEvents
    : accumulator.tokenUsageRecordEvents;
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
    const events = selectCodexUsageEvents(accumulator);
    if (events.length > 0) {
      result.set(accumulator.threadId, events);
    }
  }
  return result;
}
