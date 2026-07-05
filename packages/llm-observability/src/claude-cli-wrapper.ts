import {
  SpanStatusCode,
  type AttributeValue,
  type Span,
} from "@opentelemetry/api";
import { getLlmTracer, serializeBodyAttribute } from "./span-helpers.ts";
import {
  InitMessageSchema,
  ResultMessageSchema,
  type ClaudeResultMessage,
} from "./claude-message-schemas.ts";

export type TraceClaudeCliMetadata = {
  service: string;
  callSite: string;
  request: {
    /** Model name. Optional — falls back to the stream's init message. */
    model: string | undefined;
    /** Prompt passed to `claude -p`. */
    prompt: string;
    /** Any non-secret CLI options worth recording on the envelope. */
    options: Record<string, unknown> | undefined;
  };
};

export type TraceClaudeCliOutcome = {
  /** Full stdout of the finished process — `--output-format json` (one
   * object) or `stream-json` (NDJSON) both work. */
  stdout: string;
  exitCode: number;
  /** Wall-clock bounds of the subprocess, for span timing. */
  startTimeMs: number;
  endTimeMs: number;
};

export type ClaudeCliLogger = {
  warn: (message: string) => void;
};

const noopLogger: ClaudeCliLogger = {
  warn(message) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: message,
        component: "llm-observability",
      }),
    );
  },
};

/**
 * Emit a post-hoc `gen_ai.chat` span for a finished `claude -p` subprocess.
 * Call after the process exits, with the captured stdout — no changes to how
 * the caller pumps or parses output. The span carries
 * `gen_ai.system="claude_code_cli"` (distinguishing subscription-billed CLI
 * runs from API-billed `anthropic` calls), usage incl. cache tokens,
 * `llm.cost_usd`, and prompt/result bodies for the archive processor.
 *
 * Telemetry must never break the work it observes: stdout that fails to
 * parse produces a span flagged `llm.cli.parse_error` plus a logger warning —
 * this function never throws.
 */
export function traceClaudeCli(
  metadata: TraceClaudeCliMetadata,
  outcome: TraceClaudeCliOutcome,
  logger: ClaudeCliLogger = noopLogger,
): void {
  const tracer = getLlmTracer();
  const span = tracer.startSpan("gen_ai.chat", {
    startTime: outcome.startTimeMs,
  });

  try {
    const parsed = parseCliStdout(outcome.stdout);

    span.setAttributes(buildAttributes(metadata, outcome, parsed));
    applyStatus(span, outcome, parsed);

    if (parsed.result === undefined) {
      logger.warn(
        `llm-observability: no result message in claude CLI stdout (callSite=${metadata.callSite}, exitCode=${String(outcome.exitCode)})`,
      );
    }
  } catch (error: unknown) {
    // Defensive: buildAttributes/parse are total functions; this only fires
    // on bugs. The span still ends so the run stays visible.
    span.setAttributes({
      "llm.cli.parse_error": true,
      "gen_ai.system": "claude_code_cli",
      "llm.service": metadata.service,
      "llm.call_site": metadata.callSite,
    });
    logger.warn(
      `llm-observability: traceClaudeCli crashed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    span.end(outcome.endTimeMs);
  }
}

type ParsedCliStdout = {
  result: ClaudeResultMessage | undefined;
  initModel: string | undefined;
  sessionId: string | undefined;
  parseError: boolean;
};

/**
 * Accept both CLI output formats with one scan: `--output-format json`
 * prints a single `result` object; `stream-json` prints NDJSON whose last
 * `type:"result"` line is the same shape. Non-JSON lines (hook noise,
 * partial writes) are tolerated; `parseError` is only set when NO result
 * message could be recovered from a non-empty stdout.
 */
export function parseCliStdout(stdout: string): ParsedCliStdout {
  const parsed: ParsedCliStdout = {
    result: undefined,
    initModel: undefined,
    sessionId: undefined,
    parseError: false,
  };

  let sawJson = false;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    sawJson = true;
    observeMessage(value, parsed);
  }

  // `--output-format json` pretty-printed or otherwise multi-line: fall back
  // to parsing the whole buffer as one object.
  if (!sawJson && stdout.trim().length > 0) {
    try {
      observeMessage(JSON.parse(stdout), parsed);
      sawJson = true;
    } catch {
      // handled below
    }
  }

  parsed.parseError = stdout.trim().length > 0 && parsed.result === undefined;
  return parsed;
}

function observeMessage(value: unknown, parsed: ParsedCliStdout): void {
  const init = InitMessageSchema.safeParse(value);
  if (init.success) {
    parsed.initModel = init.data.model ?? parsed.initModel;
    parsed.sessionId = init.data.session_id ?? parsed.sessionId;
    return;
  }
  const result = ResultMessageSchema.safeParse(value);
  if (result.success) {
    parsed.result = result.data;
    parsed.sessionId = result.data.session_id ?? parsed.sessionId;
  }
}

function buildAttributes(
  metadata: TraceClaudeCliMetadata,
  outcome: TraceClaudeCliOutcome,
  parsed: ParsedCliStdout,
): Record<string, AttributeValue> {
  const attrs: Record<string, AttributeValue> = {
    "gen_ai.system": "claude_code_cli",
    "gen_ai.operation.name": "chat",
    "llm.service": metadata.service,
    "llm.call_site": metadata.callSite,
    "llm.cli.exit_code": outcome.exitCode,
    "gen_ai.input.messages": serializeBodyAttribute([
      { role: "user", content: metadata.request.prompt },
    ]),
  };

  const model = metadata.request.model ?? parsed.initModel;
  if (model !== undefined) {
    attrs["gen_ai.request.model"] = model;
    attrs["gen_ai.response.model"] = model;
  }
  if (metadata.request.options !== undefined) {
    attrs["llm.claude_code.options"] = serializeBodyAttribute(
      metadata.request.options,
    );
  }
  if (parsed.sessionId !== undefined) {
    attrs["gen_ai.response.id"] = parsed.sessionId;
    attrs["llm.claude_code.session_id"] = parsed.sessionId;
  }
  if (parsed.parseError) {
    attrs["llm.cli.parse_error"] = true;
  }

  applyResultAttrs(attrs, parsed.result);
  return attrs;
}

function applyResultAttrs(
  attrs: Record<string, AttributeValue>,
  result: ClaudeResultMessage | undefined,
): void {
  if (result === undefined) return;

  if (result.result !== undefined) {
    attrs["gen_ai.output.messages"] = serializeBodyAttribute([
      { role: "assistant", content: result.result },
    ]);
  }
  const finishReason = result.stop_reason ?? result.subtype;
  if (finishReason !== undefined) {
    attrs["gen_ai.response.finish_reasons"] = [finishReason];
  }
  if (result.total_cost_usd !== undefined) {
    attrs["llm.cost_usd"] = result.total_cost_usd;
  }
  if (result.num_turns !== undefined) {
    attrs["llm.claude_code.num_turns"] = result.num_turns;
  }

  const usage = result.usage;
  if (usage === undefined) return;
  if (usage.input_tokens !== undefined) {
    attrs["gen_ai.usage.input_tokens"] = usage.input_tokens;
  }
  if (usage.output_tokens !== undefined) {
    attrs["gen_ai.usage.output_tokens"] = usage.output_tokens;
  }
  if (usage.cache_read_input_tokens !== undefined) {
    attrs["gen_ai.usage.cache_read_input_tokens"] =
      usage.cache_read_input_tokens;
  }
  if (usage.cache_creation_input_tokens !== undefined) {
    attrs["gen_ai.usage.cache_creation_input_tokens"] =
      usage.cache_creation_input_tokens;
  }
}

function applyStatus(
  span: Span,
  outcome: TraceClaudeCliOutcome,
  parsed: ParsedCliStdout,
): void {
  if (parsed.result?.is_error === true) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: parsed.result.subtype ?? "claude_code_error",
    });
    return;
  }
  if (outcome.exitCode !== 0) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `claude exited ${String(outcome.exitCode)}`,
    });
    return;
  }
  span.setStatus({ code: SpanStatusCode.OK });
}
