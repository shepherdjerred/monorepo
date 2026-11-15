import { parseConversationEnvelope } from "#lib/history/query/messages.ts";
import { parseRecord, stringValue } from "#lib/history/query/text.ts";
import type { HistoryMessage, UsageEventEntry } from "#lib/history/types.ts";
import {
  catalogCost,
  optionalUsageNumber,
  requiredUsageNumber,
  usageEventEntry,
  type UsageCounts,
  type UsageFieldLocation,
} from "#lib/history/usage-cost.ts";
import { epochTimestamp, jsonLines } from "./jsonl.ts";

/**
 * Parses one Meta Muse `session.jsonl` event log. Every envelope carries
 * `recorded_at` in epoch microseconds.
 */

const SOURCE = "Muse";
export const MICROSECONDS_PER_MS = 1000;

export type MuseTranscript = {
  readonly messages: readonly HistoryMessage[];
  readonly usageEvents: readonly UsageEventEntry[];
  readonly workspace: string | null;
  readonly gitBranch: string | null;
  readonly sawBranch: boolean;
  readonly firstAt: string | null;
  readonly lastAt: string | null;
};

/**
 * Verified against real `model_completed` records: `input_tokens` is the
 * whole prompt (it tracks the record's `estimated_prompt_tokens`), and
 * `cache_read_tokens` (always equal to `cached_tokens`) never exceeds it, so
 * the cache read is the OpenAI-style cached subset of `input_tokens`, not
 * Anthropic-style additive input. `reasoning_tokens` is likewise a subset of
 * `output_tokens`. `cache_write_tokens` has only ever been zero; whether a
 * nonzero value is part of `input_tokens` is unverified, so one fails the
 * scan rather than being counted under a guessed convention.
 */
function museUsageCounts(
  usage: Record<string, unknown>,
  location: UsageFieldLocation,
): UsageCounts {
  const inputTokens = requiredUsageNumber(
    SOURCE,
    usage,
    "input_tokens",
    location,
  );
  const cacheRead = optionalUsageNumber(
    SOURCE,
    usage,
    "cache_read_tokens",
    location,
  );
  const cacheWrite = optionalUsageNumber(
    SOURCE,
    usage,
    "cache_write_tokens",
    location,
  );
  if (cacheRead > inputTokens) {
    throw new Error(
      `Muse usage reports more cache-read than input tokens on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  if (cacheWrite > 0) {
    throw new Error(
      `Muse usage reports cache-write tokens, whose billing convention is unverified, on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return {
    inputTokens,
    outputTokens: requiredUsageNumber(SOURCE, usage, "output_tokens", location),
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cachedInputTokens: cacheRead,
    reasoningTokens: optionalUsageNumber(
      SOURCE,
      usage,
      "reasoning_tokens",
      location,
    ),
  };
}

function museUsageEvent(
  event: Record<string, unknown>,
  occurredAt: string | null,
  location: UsageFieldLocation,
): UsageEventEntry {
  const usage = parseRecord(event["usage"]);
  const model = stringValue(event["model"]);
  if (usage === null || model === null) {
    throw new Error(
      `Malformed Muse model_completed record on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  if (occurredAt === null) {
    throw new Error(
      `Muse model_completed record missing its timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const counts = museUsageCounts(usage, location);
  return usageEventEntry(
    occurredAt,
    model,
    counts,
    catalogCost([model], counts),
  );
}

/** `args` is the call's JSON-encoded argument object. */
function museToolArguments(
  value: unknown,
  location: UsageFieldLocation,
): unknown {
  if (typeof value !== "string") {
    throw new TypeError(
      `Malformed Muse tool call arguments on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      `Malformed Muse tool call arguments on line ${String(location.lineNumber)} in ${location.filePath}`,
      { cause: error },
    );
  }
}

function museToolCalls(
  event: Record<string, unknown>,
  createdAt: string | null,
  location: UsageFieldLocation,
  maxCharacters: number,
): HistoryMessage[] {
  const calls = event["tool_calls"];
  if (!Array.isArray(calls)) {
    throw new TypeError(
      `Malformed Muse tool calls on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return calls.flatMap((value: unknown) => {
    const call = parseRecord(value);
    const name = stringValue(call?.["name"]);
    if (call === null || name === null) {
      throw new Error(
        `Muse tool call missing its name on line ${String(location.lineNumber)} in ${location.filePath}`,
      );
    }
    return parseConversationEnvelope(
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name,
            input: museToolArguments(call["args"], location),
          },
        ],
      },
      "assistant",
      createdAt,
      maxCharacters,
    );
  });
}

function museToolResults(
  event: Record<string, unknown>,
  createdAt: string | null,
  location: UsageFieldLocation,
  maxCharacters: number,
): HistoryMessage[] {
  const results = event["results"];
  if (!Array.isArray(results)) {
    throw new TypeError(
      `Malformed Muse tool results on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return results.flatMap((value: unknown) =>
    parseConversationEnvelope(
      {
        role: "tool",
        content: stringValue(parseRecord(value)?.["text"]) ?? "",
      },
      "tool",
      createdAt,
      maxCharacters,
    ),
  );
}

/**
 * A run's `started` prompt is the user's message (`model_user_messages` and
 * `runtime.user_intent.accepted` repeat it or carry injected context);
 * `assistant_message_committed` is the reply, `assistant_tool_calls_committed`
 * the tool invocations, and `tool_result_batch_committed` their output.
 * Reasoning (`reasoning_committed`, encrypted) is not indexed.
 */
function museRunMessages(
  event: Record<string, unknown>,
  createdAt: string | null,
  location: UsageFieldLocation,
  maxCharacters: number,
): HistoryMessage[] {
  switch (stringValue(event["kind"]) ?? "") {
    case "started": {
      return parseConversationEnvelope(
        { role: "user", content: stringValue(event["prompt"]) ?? "" },
        "user",
        createdAt,
        maxCharacters,
      );
    }
    case "assistant_message_committed": {
      return parseConversationEnvelope(
        { role: "assistant", content: stringValue(event["text"]) ?? "" },
        "assistant",
        createdAt,
        maxCharacters,
      );
    }
    case "assistant_tool_calls_committed": {
      return museToolCalls(event, createdAt, location, maxCharacters);
    }
    case "tool_result_batch_committed": {
      return museToolResults(event, createdAt, location, maxCharacters);
    }
    default: {
      return [];
    }
  }
}

/**
 * Lines without a `payload_type` are log-retention artifacts, never events:
 * `retained_marker` lines stand in for records the log compacted away, and a
 * `retained_frame` wraps a settled transaction's bookkeeping (permission
 * profile records). Any other envelope without one is malformed.
 */
function isRetentionLine(record: Record<string, unknown>): boolean {
  return (
    record["retained_marker"] !== undefined ||
    record["omitted_record"] !== undefined ||
    record["retained_frame"] !== undefined
  );
}

/** The run events this reader takes content or usage from. */
const USED_RUN_EVENTS: ReadonlySet<string> = new Set([
  "started",
  "assistant_message_committed",
  "assistant_tool_calls_committed",
  "tool_result_batch_committed",
  "model_completed",
]);

/**
 * Whether this reader takes anything from the record. Fork bookkeeping
 * (`session.fork.created`, `.model_prefix`, `.turn`) is written without a
 * `recorded_at` and copies the source session's turns, which are indexed
 * from the source's own log; it is not used, so its missing timestamp is
 * accepted. A used record must carry a valid one.
 */
function isUsedRecord(
  payloadType: string,
  payload: Record<string, unknown>,
): boolean {
  switch (payloadType) {
    case "runtime.session.metadata":
    case "session.workspace_branch.observed": {
      return true;
    }
    case "runtime.session": {
      return (
        stringValue(payload["kind"]) === "run" &&
        USED_RUN_EVENTS.has(
          stringValue(parseRecord(payload["event"])?.["kind"]) ?? "",
        )
      );
    }
    default: {
      return false;
    }
  }
}

function branchName(record: Record<string, unknown> | null): string | null {
  const reference = parseRecord(record?.["reference"]);
  return stringValue(reference?.["kind"]) === "branch"
    ? stringValue(reference?.["name"])
    : null;
}

type MuseEvent = {
  readonly payloadType: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
};

/**
 * The event a log line carries, or null for a line this reader skips: a
 * retention artifact, or an unused record written without a timestamp.
 */
function museEvent(
  record: Record<string, unknown> | null,
  location: UsageFieldLocation,
): MuseEvent | null {
  if (record === null || isRetentionLine(record)) {
    return null;
  }
  const payloadType = stringValue(record["payload_type"]);
  const payload = parseRecord(record["payload"]);
  if (payloadType === null || payload === null) {
    throw new Error(
      `Malformed Muse event envelope on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const recordedAt = record["recorded_at"];
  if (recordedAt == null && !isUsedRecord(payloadType, payload)) {
    return null;
  }
  const createdAt = epochTimestamp(recordedAt, MICROSECONDS_PER_MS, {
    source: SOURCE,
    label: "event",
    location,
  });
  return { payloadType, payload, createdAt };
}

export async function readMuseTranscript(
  filePath: string,
  maxCharacters = Number.POSITIVE_INFINITY,
): Promise<MuseTranscript> {
  const messages: HistoryMessage[] = [];
  const usageEvents: UsageEventEntry[] = [];
  let workspace: string | null = null;
  let gitBranch: string | null = null;
  let sawBranch = false;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for await (const { record, location } of jsonLines(SOURCE, filePath)) {
    const line = museEvent(record, location);
    if (line === null) {
      continue;
    }
    const { payloadType, payload, createdAt } = line;
    firstAt ??= createdAt;
    lastAt = createdAt;
    switch (payloadType) {
      case "runtime.session.metadata": {
        workspace =
          stringValue(parseRecord(payload["record"])?.["workspace_root"]) ??
          workspace;
        break;
      }
      case "session.workspace_branch.observed": {
        // The latest observation wins; a detached HEAD has no branch.
        gitBranch = branchName(parseRecord(payload["record"]));
        sawBranch = true;
        break;
      }
      case "runtime.session": {
        const event = parseRecord(payload["event"]);
        if (event === null || stringValue(payload["kind"]) !== "run") {
          break;
        }
        if (stringValue(event["kind"]) === "model_completed") {
          usageEvents.push(museUsageEvent(event, createdAt, location));
        } else {
          messages.push(
            ...museRunMessages(event, createdAt, location, maxCharacters),
          );
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  return {
    messages,
    usageEvents,
    workspace,
    gitBranch,
    sawBranch,
    firstAt,
    lastAt,
  };
}
