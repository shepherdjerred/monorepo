// JSONL → OTel adapter. Codex CLI isn't an in-process SDK we can wrap with the
// existing llm-observability `traceOpenAi` helpers; instead we subscribe to the
// codex-jsonl event bus (T2) and synthesize the same shape of spans those
// helpers would have produced. The archive SpanProcessor wired up in
// observability/tracing.ts picks them up by the `gen_ai.*` attributes and
// uploads request/response bodies to SeaweedFS automatically.

import { context, trace, type Span, type Tracer } from "@opentelemetry/api";
import { z } from "zod";
import { logger } from "#src/logger.ts";
import type { CodexEvent, CodexJsonlParser } from "./codex-jsonl.ts";

export type CodexTraceOptions = {
  // Stable id for this goal run, used to correlate all spans + S3 artifacts.
  goalId: string;
  goal: string;
  model: string;
  requestedBy: string;
  // Inlined into the root span attrs so the archive envelope contains the same
  // context the model saw.
  gameStateSummary: string;
  // The full rendered prompt (system instructions). Logged once on the root
  // span; per-turn input.messages will be deltas (just the new user/tool turn).
  initialPrompt: string;
};

export type CodexTrace = {
  // Closes the root span (call once when the goal exits — completed, failed,
  // timeout, replaced, shutdown). Idempotent.
  end: () => void;
};

type ToolCall = {
  span: Span;
  command: string;
  startedAtMs: number;
};

const SYSTEM = "openai";

/**
 * Subscribe to the codex-jsonl event bus and emit spans. Returns a `CodexTrace`
 * whose `end()` finalizes the root span — call from observeProcess (or any
 * terminal path) when the codex process exits.
 *
 * No-op (returns a tracer-less shim) when telemetry is disabled — the caller
 * doesn't need to check.
 */
export function attachCodexTrace(
  parser: CodexJsonlParser,
  options: CodexTraceOptions,
): CodexTrace {
  const tracer = trace.getTracer("@discord-plays-pokemon/goal-trace");
  // Root span: covers the whole codex exec invocation.
  const rootSpan = tracer.startSpan("pokemon.goal.run", {
    attributes: {
      "pokemon.goal.id": options.goalId,
      "pokemon.goal.text": options.goal,
      "pokemon.goal.requested_by": options.requestedBy,
      "pokemon.goal.game_state": options.gameStateSummary,
      [`${SYSTEM}.system`]: SYSTEM,
      "gen_ai.system": SYSTEM,
      "gen_ai.request.model": options.model,
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
          "pokemon.goal.turn",
          {
            attributes: {
              "pokemon.goal.turn_index": turnCounter,
              "gen_ai.system": SYSTEM,
              "gen_ai.request.model": options.model,
              // Initial turn carries the rendered system+user prompt; later
              // turns just leave this empty (the bus doesn't surface deltas).
              ...(turnCounter === 1 && {
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
  nextId: () => string;
};

const RecordSchema = z.record(z.string(), z.unknown());

/**
 * Bridge for tool-call events. Codex's `--json` output uses event types like
 * `ExecCommandBegin` / `ExecCommandEnd` which our parser surfaces as `other`
 * events (we don't pin to specific types so the parser tolerates schema drift).
 * We pattern-match by raw shape.
 */
function handleToolEvents(args: ToolHandlerArgs): void {
  const { tracer, rootCtx, openTools, event, nextId } = args;
  const parsed = RecordSchema.safeParse(event.raw);
  if (!parsed.success) return;
  const record = parsed.data;
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "ExecCommandBegin" || type === "exec_command_begin") {
    const callId = stringField(record, "call_id") ?? nextId();
    const command = collapseCommand(record);
    const span = tracer.startSpan(
      "pokemon.goal.tool",
      {
        attributes: {
          "pokemon.tool.command": command,
          "pokemon.tool.call_id": callId,
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
      "pokemon.tool.exit_code": numberField(record, "exit_code") ?? -1,
      "pokemon.tool.duration_ms": Date.now() - open.startedAtMs,
      "pokemon.tool.stdout_snippet": snippet(
        stringField(record, "stdout") ?? "",
      ),
      "pokemon.tool.stderr_snippet": snippet(
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
  const raw = record.command;
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
