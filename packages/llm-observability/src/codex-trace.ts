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
import { redactText } from "./redact.ts";
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

  // Copied onto every tool span. OTel span attributes are NOT inherited from
  // the parent, yet the archive processor reads gen_ai.system,
  // gen_ai.request.model, and llm.call_site off each span it uploads — without
  // these, tool-body archives land under provider "unknown" with no model or
  // correlation context (e.g. pokemon.goal.id). Root attributes go first so the
  // reserved identity keys below always win.
  const toolSpanIdentity: Record<string, string | number | boolean> = {
    ...options.rootAttributes,
    "gen_ai.system": SYSTEM,
    "gen_ai.request.model": options.model,
    "llm.service": options.service,
    "llm.call_site": options.callSite,
  };

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
          spanIdentity: toolSpanIdentity,
          logger,
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
  /** Identity/correlation attrs copied onto each tool span (not parent-inherited). */
  spanIdentity: Record<string, string | number | boolean>;
  nextId: () => string;
  logger: CodexLogger;
};

const RecordSchema = z.record(z.string(), z.unknown());

// Nested `item` payload of the item.started / item.completed events emitted by
// codex-cli's experimental JSON output (the shape the production Dockerfile pin
// @openai/codex@0.139.0 uses). A command's combined output lives in
// `aggregated_output`; separate stdout/stderr are present on some versions.
const CommandItemSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  command: z.union([z.string(), z.array(z.unknown())]).optional(),
  aggregated_output: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exit_code: z.number().optional(),
});

/**
 * Bridge for tool-call events. Two wire formats reach us as `other` events
 * (the parser doesn't pin types, so it tolerates schema drift):
 *   - Modern codex-cli (≥ ~0.13x): `item.started` / `item.completed` wrapping a
 *     `command_execution` item, correlated by `item.id`, output in
 *     `aggregated_output`.
 *   - Legacy: top-level `ExecCommandBegin` / `ExecCommandEnd`, correlated by
 *     `call_id`, output in top-level `stdout` / `stderr`.
 * We pattern-match by raw shape and normalize both into begin/end.
 */
function handleToolEvents(args: ToolHandlerArgs): void {
  const parsed = RecordSchema.safeParse(args.event.raw);
  if (!parsed.success) return;
  const record = parsed.data;
  const type = typeof record["type"] === "string" ? record["type"] : "";

  if (type === "item.started" || type === "item.completed") {
    handleItemEvent(args, type, record);
    return;
  }
  handleLegacyEvent(args, type, record);
}

// Modern codex-cli: item.started / item.completed wrapping a command_execution
// item, correlated by item.id, output in aggregated_output.
function handleItemEvent(
  args: ToolHandlerArgs,
  type: string,
  record: Record<string, unknown>,
): void {
  const item = CommandItemSchema.safeParse(record["item"]);
  if (!item.success || item.data.type !== "command_execution") return;
  const callId = item.data.id ?? args.nextId();
  if (type === "item.started") {
    beginTool(args, callId, commandToString(item.data.command));
    return;
  }
  // `aggregated_output` is the combined stream; fall back through it when a
  // version doesn't split stdout/stderr.
  endTool(args, callId, {
    exitCode: item.data.exit_code ?? -1,
    stdout: item.data.stdout ?? item.data.aggregated_output ?? "",
    stderr: item.data.stderr ?? "",
  });
}

// Legacy codex-cli: top-level ExecCommandBegin / ExecCommandEnd, correlated by
// call_id, output in top-level stdout / stderr.
function handleLegacyEvent(
  args: ToolHandlerArgs,
  type: string,
  record: Record<string, unknown>,
): void {
  if (type === "ExecCommandBegin" || type === "exec_command_begin") {
    const callId = stringField(record, "call_id") ?? args.nextId();
    beginTool(args, callId, collapseCommand(record));
    return;
  }
  if (type === "ExecCommandEnd" || type === "exec_command_end") {
    const callId = stringField(record, "call_id");
    if (callId === undefined) return;
    endTool(args, callId, {
      exitCode: numberField(record, "exit_code") ?? -1,
      stdout: stringField(record, "stdout") ?? "",
      stderr: stringField(record, "stderr") ?? "",
    });
  }
}

type ToolResult = { exitCode: number; stdout: string; stderr: string };

function beginTool(
  args: ToolHandlerArgs,
  callId: string,
  rawCommand: string,
): void {
  const { tracer, rootCtx, openTools, spanName, attrPrefix, spanIdentity } =
    args;
  // Redact before anything is stored or logged: an attacker-controlled goal can
  // put a credential on the command line (e.g. `pokemonctl --token=…`).
  const fullCommand = redactText(rawCommand);
  const span = tracer.startSpan(
    spanName,
    {
      attributes: {
        ...spanIdentity,
        [`${attrPrefix}.command`]: snippet(fullCommand),
        [`${attrPrefix}.call_id`]: callId,
      },
    },
    rootCtx,
  );
  openTools.set(callId, {
    span,
    command: fullCommand,
    startedAtMs: Date.now(),
  });
  // Structured log for live kubectl/Loki blackbox (full command, not snipped).
  args.logger.info?.(`codex tool begin: ${fullCommand}`);
}

function endTool(
  args: ToolHandlerArgs,
  callId: string,
  result: ToolResult,
): void {
  const { openTools, attrPrefix } = args;
  const { exitCode } = result;
  const open = openTools.get(callId);
  if (open === undefined) return;
  const durationMs = Date.now() - open.startedAtMs;
  // Redact before both live logging and S3 archival: a tool run can dump
  // credentials (`env`, `cat auth.json`) onto stdout/stderr.
  const stdout = redactText(result.stdout);
  const stderr = redactText(result.stderr);
  // Dual-track: short snippets stay on Tempo-bound attrs; full bodies use
  // gen_ai.tool.* keys that LlmArchiveSpanProcessor strips to S3.
  open.span.setAttributes({
    [`${attrPrefix}.exit_code`]: exitCode,
    [`${attrPrefix}.duration_ms`]: durationMs,
    [`${attrPrefix}.stdout_snippet`]: snippet(stdout),
    [`${attrPrefix}.stderr_snippet`]: snippet(stderr),
    "gen_ai.tool.stdout": bodyForArchive(stdout),
    "gen_ai.tool.stderr": bodyForArchive(stderr),
  });
  open.span.end();
  openTools.delete(callId);
  args.logger.info?.(
    `codex tool end: exit=${String(exitCode)} durationMs=${String(durationMs)} cmd=${open.command} stdout=${bodyForArchive(stdout)} stderr=${bodyForArchive(stderr)}`,
  );
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
  return commandToString(record["command"]);
}

// A codex command is either a string or an argv array. Returns the full,
// un-snipped command (callers snippet where needed).
function commandToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map(String).join(" ");
  return "<unknown>";
}

function snippet(value: string): string {
  if (value.length <= 200) return value;
  return `${value.slice(0, 200)}…`;
}

// Cap archived/logged tool bodies so a pathological pokemonctl dump can't blow
// span attribute limits. 16 KiB is enough for full /state + movement JSON.
const TOOL_BODY_MAX = 16_384;

function bodyForArchive(value: string): string {
  if (value.length <= TOOL_BODY_MAX) return value;
  return `${value.slice(0, TOOL_BODY_MAX)}…`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
