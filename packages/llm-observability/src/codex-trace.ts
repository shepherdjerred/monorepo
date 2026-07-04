// JSONL → OTel adapter for Codex CLI runs. Codex isn't an in-process SDK we
// can wrap with `traceOpenAi`; instead we subscribe to the codex-jsonl event
// bus and synthesize the same shape of spans those wrappers would have
// produced. Any archive SpanProcessor registered on the tracer provider picks
// them up by the `gen_ai.*` attributes and uploads bodies automatically.
//
// Promoted from discord-plays-pokemon's goal runner, generalized: span names,
// tool-attribute prefix, and root attributes are parameters instead of
// hardcoded `pokemon.*` values.

import { context, trace, type Span, type Tracer } from "@opentelemetry/api";
import { z } from "zod";
import { getLlmTracer } from "./span-helpers.ts";
import {
  type CodexLogger,
  type CodexEvent,
  type CodexJsonlParser,
} from "./codex-jsonl.ts";

export type CodexTraceOptions = {
  /** Service identity recorded on every span (`llm.service`). */
  service: string;
  /** Call-site identity recorded on every span (`llm.call_site`). */
  callSite: string;
  /** Model name for `gen_ai.request.model`. */
  model: string;
  /**
   * Span-name prefix: spans are named `<prefix>.run`, `<prefix>.turn`,
   * `<prefix>.tool`. Defaults to `codex.agent`.
   */
  spanPrefix?: string | undefined;
  /**
   * Attribute-key prefix for tool spans (`<prefix>.command`, `.exit_code`,
   * `.duration_ms`, `.stdout_snippet`, `.stderr_snippet`, `.call_id`).
   * Defaults to `<spanPrefix>.tool`.
   */
  toolAttributePrefix?: string | undefined;
  /**
   * Extra attributes inlined onto the root span (e.g. a goal id) so the
   * archive envelope carries the caller's correlation context.
   */
  rootAttributes?: Record<string, string | number | boolean> | undefined;
  /**
   * The full rendered prompt. Recorded as `gen_ai.input.messages` on the
   * first turn span; later turns leave it empty (the bus doesn't surface
   * deltas).
   */
  initialPrompt?: string | undefined;
  logger?: CodexLogger | undefined;
};

export type CodexTrace = {
  /**
   * Closes the root span (call once when the run exits — completed, failed,
   * timeout, killed). Idempotent.
   */
  end: () => void;
};

type ToolCall = {
  span: Span;
  command: string;
  startedAtMs: number;
};

const SYSTEM = "openai";

const noopLogger: CodexLogger = {
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
 * Subscribe to a codex-jsonl event bus and emit spans. Returns a `CodexTrace`
 * whose `end()` finalizes the root span — call from the process-exit path.
 */
export function attachCodexTrace(
  parser: CodexJsonlParser,
  options: CodexTraceOptions,
): CodexTrace {
  const tracer = getLlmTracer();
  const logger = options.logger ?? noopLogger;
  const spanPrefix = options.spanPrefix ?? "codex.agent";
  const toolAttrPrefix = options.toolAttributePrefix ?? `${spanPrefix}.tool`;

  // Root span: covers the whole codex exec invocation.
  const rootSpan = tracer.startSpan(`${spanPrefix}.run`, {
    attributes: {
      ...options.rootAttributes,
      "gen_ai.system": SYSTEM,
      "gen_ai.request.model": options.model,
      "llm.service": options.service,
      "llm.call_site": options.callSite,
    },
  });
  const rootCtx = trace.setSpan(context.active(), rootSpan);

  let currentTurn: { span: Span; agentMessages: string[] } | undefined;
  let turnCounter = 0;
  // Tool calls indexed by call_id (or a synthesized counter if absent).
  const openTools = new Map<string, ToolCall>();
  let toolCounter = 0;
  let ended = false;

  const onEvent = (event: CodexEvent): void => {
    try {
      handleEvent(event);
    } catch (error) {
      logger.warn(
        `codex-trace: handler threw for ${event.kind}: ${stringifyError(error)}`,
      );
    }
  };

  function handleEvent(event: CodexEvent): void {
    switch (event.kind) {
      case "turn.started": {
        turnCounter += 1;
        const turnSpan = tracer.startSpan(
          `${spanPrefix}.turn`,
          {
            attributes: {
              // Prefix-derived so dpp keeps its historical
              // `pokemon.goal.turn_index` attribute name.
              [`${spanPrefix}.turn_index`]: turnCounter,
              "gen_ai.system": SYSTEM,
              "gen_ai.request.model": options.model,
              "llm.service": options.service,
              "llm.call_site": options.callSite,
              // Initial turn carries the rendered system+user prompt; later
              // turns just leave this empty (the bus doesn't surface deltas).
              ...(turnCounter === 1 &&
                options.initialPrompt !== undefined && {
                  "gen_ai.input.messages": options.initialPrompt,
                }),
            },
          },
          rootCtx,
        );
        currentTurn = { span: turnSpan, agentMessages: [] };
        return;
      }
      case "agent_message": {
        if (currentTurn !== undefined) {
          currentTurn.agentMessages.push(event.text);
        }
        return;
      }
      case "turn.completed": {
        if (currentTurn === undefined) return;
        const { span, agentMessages } = currentTurn;
        span.setAttributes({
          "gen_ai.usage.input_tokens": event.usage.inputTokens,
          "gen_ai.usage.cache_read_input_tokens": event.usage.cachedInputTokens,
          "gen_ai.usage.output_tokens":
            event.usage.outputTokens + event.usage.reasoningOutputTokens,
          "gen_ai.usage.reasoning_tokens": event.usage.reasoningOutputTokens,
        });
        if (agentMessages.length > 0) {
          span.setAttributes({
            "gen_ai.output.messages": JSON.stringify(agentMessages),
          });
        }
        span.end();
        currentTurn = undefined;
        return;
      }
      case "other":
        handleToolEvents({
          tracer,
          rootCtx,
          openTools,
          event,
          spanName: `${spanPrefix}.tool`,
          attrPrefix: toolAttrPrefix,
          nextId: () => {
            toolCounter += 1;
            return `tool_${String(toolCounter)}`;
          },
        });
        return;
      case "parse_error":
        // Surfaced for visibility but doesn't span — the parser already logged.
        rootSpan.addEvent("codex.parse_error", { line: event.line });
        return;
      default:
    }
  }

  const unsubscribe = parser.subscribe(onEvent);

  return {
    end(): void {
      if (ended) return;
      ended = true;
      unsubscribe();
      // Close any still-open turn (codex died mid-turn).
      if (currentTurn !== undefined) {
        currentTurn.span.end();
        currentTurn = undefined;
      }
      for (const tool of openTools.values()) {
        tool.span.end();
      }
      openTools.clear();
      rootSpan.end();
    },
  };
}

type ToolHandlerArgs = {
  tracer: Tracer;
  rootCtx: ReturnType<typeof context.active>;
  openTools: Map<string, ToolCall>;
  event: Extract<CodexEvent, { kind: "other" }>;
  spanName: string;
  attrPrefix: string;
  nextId: () => string;
};

const RecordSchema = z.record(z.string(), z.unknown());

/**
 * Bridge for tool-call events. Codex's `--json` output uses event types like
 * `ExecCommandBegin` / `ExecCommandEnd` which the parser surfaces as `other`
 * events (we don't pin to specific types so the parser tolerates schema
 * drift). We pattern-match by raw shape.
 */
function handleToolEvents(args: ToolHandlerArgs): void {
  const { tracer, rootCtx, openTools, event, spanName, attrPrefix, nextId } =
    args;
  const parsed = RecordSchema.safeParse(event.raw);
  if (!parsed.success) return;
  const record = parsed.data;
  const type = typeof record["type"] === "string" ? record["type"] : "";

  if (type === "ExecCommandBegin" || type === "exec_command_begin") {
    const callId = stringField(record, "call_id") ?? nextId();
    const command = collapseCommand(record);
    const span = tracer.startSpan(
      spanName,
      {
        attributes: {
          [`${attrPrefix}.command`]: command,
          [`${attrPrefix}.call_id`]: callId,
        },
      },
      rootCtx,
    );
    openTools.set(callId, { span, command, startedAtMs: Date.now() });
    return;
  }

  if (type === "ExecCommandEnd" || type === "exec_command_end") {
    const callId = stringField(record, "call_id");
    if (callId === undefined) return;
    const open = openTools.get(callId);
    if (open === undefined) return;
    open.span.setAttributes({
      [`${attrPrefix}.exit_code`]: numberField(record, "exit_code") ?? -1,
      [`${attrPrefix}.duration_ms`]: Date.now() - open.startedAtMs,
      [`${attrPrefix}.stdout_snippet`]: snippet(
        stringField(record, "stdout") ?? "",
      ),
      [`${attrPrefix}.stderr_snippet`]: snippet(
        stringField(record, "stderr") ?? "",
      ),
    });
    open.span.end();
    openTools.delete(callId);
    return;
  }
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function collapseCommand(record: Record<string, unknown>): string {
  const raw = record["command"];
  if (typeof raw === "string") return snippet(raw);
  if (Array.isArray(raw)) {
    return snippet(raw.map(String).join(" "));
  }
  return "<unknown>";
}

function snippet(value: string): string {
  if (value.length <= 200) return value;
  return `${value.slice(0, 200)}…`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
