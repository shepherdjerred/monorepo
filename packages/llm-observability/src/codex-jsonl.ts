// Streaming parser for Codex CLI's `--json` stdout (one JSON event per line).
// Consumers subscribe via the event bus: cost accounting reads the running
// usage total, codex-trace synthesizes OTel spans. The parser is intentionally
// schema-permissive: Codex's event names change between CLI versions, so we
// extract the few fields we care about with Zod and pass everything else
// through as the raw record for downstream code that wants more.
//
// Promoted from discord-plays-pokemon's goal runner; the only changes are the
// injected logger (instead of dpp's) and the usage type living here.

import { z } from "zod";

export type CodexTurnUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export const EMPTY_CODEX_USAGE: CodexTurnUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

export function addCodexUsage(
  left: CodexTurnUsage,
  right: CodexTurnUsage,
): CodexTurnUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens:
      left.reasoningOutputTokens + right.reasoningOutputTokens,
  };
}

export type CodexLogger = {
  warn: (message: string) => void;
  info?: (message: string) => void;
};

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

// Discriminator + fields we depend on. Unknown events still land on the bus
// as `raw` so codex-trace can fan them out into span events.
const TurnUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    cached_input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    reasoning_output_tokens: z.number().int().nonnegative(),
  })
  .partial();

const TurnCompletedSchema = z.object({
  type: z.literal("turn.completed"),
  usage: TurnUsageSchema.optional(),
});

const ItemCompletedSchema = z.object({
  type: z.literal("item.completed"),
  item: z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    text: z.string().optional(),
  }),
});

const TypedEventSchema = z.looseObject({
  type: z.string(),
});

export type CodexEvent =
  | { kind: "turn.started"; raw: unknown }
  | { kind: "turn.completed"; usage: CodexTurnUsage; raw: unknown }
  | { kind: "agent_message"; text: string; raw: unknown }
  | { kind: "other"; type: string; raw: unknown }
  | { kind: "parse_error"; line: string; error: unknown };

export type CodexEventListener = (event: CodexEvent) => void;

type ParserState = {
  total: CodexTurnUsage;
  listeners: CodexEventListener[];
};

export type CodexJsonlParser = {
  push: (chunk: string) => void;
  finish: () => void;
  total: () => CodexTurnUsage;
  subscribe: (listener: CodexEventListener) => () => void;
};

export function createCodexJsonlParser(
  logger: CodexLogger = noopLogger,
): CodexJsonlParser {
  const state: ParserState = {
    total: { ...EMPTY_CODEX_USAGE },
    listeners: [],
  };
  let buffer = "";

  const emit = (event: CodexEvent): void => {
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn(`codex jsonl listener threw: ${stringifyError(error)}`);
      }
    }
  };

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      emit({ kind: "parse_error", line: trimmed, error });
      logger.info?.(`codex stdout (non-json): ${truncate(trimmed, 500)}`);
      return;
    }

    const typed = TypedEventSchema.safeParse(parsed);
    if (!typed.success) {
      emit({ kind: "other", type: "<unknown>", raw: parsed });
      return;
    }

    switch (typed.data.type) {
      case "turn.started":
        emit({ kind: "turn.started", raw: parsed });
        return;
      case "turn.completed": {
        const completed = TurnCompletedSchema.safeParse(parsed);
        const usage = normalizeUsage(
          completed.success ? completed.data.usage : undefined,
        );
        state.total = addCodexUsage(state.total, usage);
        emit({ kind: "turn.completed", usage, raw: parsed });
        return;
      }
      case "item.completed": {
        const item = ItemCompletedSchema.safeParse(parsed);
        if (
          item.success &&
          item.data.item.type === "agent_message" &&
          typeof item.data.item.text === "string"
        ) {
          const text = item.data.item.text;
          logger.info?.(`codex agent_message: ${truncate(text, 1000)}`);
          emit({ kind: "agent_message", text, raw: parsed });
          return;
        }
        emit({ kind: "other", type: typed.data.type, raw: parsed });
        return;
      }
      default:
        emit({ kind: "other", type: typed.data.type, raw: parsed });
    }
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        consumeLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    },
    finish(): void {
      if (buffer.length > 0) {
        consumeLine(buffer);
        buffer = "";
      }
    },
    total(): CodexTurnUsage {
      return { ...state.total };
    },
    subscribe(listener: CodexEventListener): () => void {
      state.listeners.push(listener);
      return () => {
        const index = state.listeners.indexOf(listener);
        if (index !== -1) state.listeners.splice(index, 1);
      };
    },
  };
}

function normalizeUsage(
  raw: z.infer<typeof TurnUsageSchema> | undefined,
): CodexTurnUsage {
  return {
    inputTokens: raw?.input_tokens ?? 0,
    cachedInputTokens: raw?.cached_input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    reasoningOutputTokens: raw?.reasoning_output_tokens ?? 0,
  };
}

export async function pumpCodexStdout(
  stream: ReadableStream<Uint8Array> | null,
  parser: CodexJsonlParser,
): Promise<void> {
  if (stream === null) return;
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      parser.push(decoder.decode(result.value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  parser.push(decoder.decode());
  parser.finish();
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}… (${String(value.length - limit)} more chars)`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
