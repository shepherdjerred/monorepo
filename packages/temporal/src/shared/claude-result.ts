import { z } from "zod/v4";

/**
 * Subset of fields we read off `claude -p`'s final `type:"result"` message
 * for cost / usage instrumentation. Other fields exist; we only validate
 * the ones we use. Emitted identically by `--output-format json` (one
 * object) and `--output-format stream-json` (the last NDJSON line).
 */
export const ClaudeResultMessage = z.object({
  type: z.literal("result"),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  duration_ms: z.number().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cache_creation_input_tokens: z.number().int().nonnegative().optional(),
      cache_read_input_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type ClaudeResultMessage = z.infer<typeof ClaudeResultMessage>;

const ResultTypeProbe = z.object({ type: z.literal("result") });

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Extract a single JSON object from an agent's free-text result. We no
 * longer pass `--json-schema` to claude (that flag wedges the CLI — it
 * produces zero output until killed), so the agent returns JSON per the
 * prompt instructions, which can arrive wrapped in ```json fences or with
 * incidental surrounding prose. Strips a fenced block if present, then
 * falls back to the outermost `{ … }` span. Throws if no object is found.
 */
export function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip a ```json … ``` (or bare ``` … ```) fence if present. Two anchored
  // replaces avoid the super-linear backtracking a single wrapping regex hits.
  const candidate = trimmed.startsWith("```")
    ? trimmed
        .replace(/^```(?:json)?[ \t]*\r?\n?/, "")
        .replace(/\r?\n?```$/, "")
        .trim()
    : trimmed;
  const direct = tryParseJson(candidate);
  if (direct !== undefined) {
    return direct;
  }
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return JSON.parse(candidate.slice(first, last + 1));
  }
  throw new Error("no JSON object found in agent result");
}

/**
 * Extract the final `type:"result"` message from a claude subprocess's
 * stdout, supporting BOTH output formats:
 *
 * - `--output-format json` — the whole stdout is one JSON object.
 * - `--output-format stream-json` — NDJSON, one JSON object per line; the
 *   answer is the LAST line whose `type === "result"`.
 *
 * Tries a whole-string parse first (the legacy single-object shape), then
 * falls back to scanning NDJSON lines. Throws with a useful message when
 * no result message is present (e.g. a run that was killed before claude
 * emitted its final message).
 */
export function parseClaudeResultMessage(stdout: string): ClaudeResultMessage {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("claude produced no stdout to parse for a result message");
  }

  const whole = tryParseJson(trimmed);
  if (whole !== undefined && ResultTypeProbe.safeParse(whole).success) {
    return ClaudeResultMessage.parse(whole);
  }

  const lines = trimmed.split("\n");
  let lastResult: unknown;
  for (const line of lines) {
    const obj = tryParseJson(line.trim());
    if (obj !== undefined && ResultTypeProbe.safeParse(obj).success) {
      lastResult = obj;
    }
  }
  if (lastResult === undefined) {
    throw new Error(
      `no claude result message (type:"result") found in ${String(lines.length)} stdout line(s)`,
    );
  }
  return ClaudeResultMessage.parse(lastResult);
}

/**
 * High-signal, low-noise summary of one stream-json NDJSON line, for live
 * logging of what the agent is doing (system init, assistant turns + the
 * tools they call, the final result). Returns `undefined` for lines that
 * aren't parseable JSON event objects (so callers can skip them).
 */
export type ClaudeStreamEventSummary = {
  type: string;
  subtype?: string;
  /** Names of `tool_use` blocks in an assistant message. */
  toolNames?: string[];
  /** Total chars of assistant text blocks (content elided — may be noisy). */
  textChars?: number;
  numTurns?: number;
  isError?: boolean;
  durationMs?: number;
};

const StreamEventProbe = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  message: z
    .object({
      content: z
        .array(
          z.object({
            type: z.string(),
            name: z.string().optional(),
            text: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export function summarizeClaudeStreamLine(
  line: string,
): ClaudeStreamEventSummary | undefined {
  const obj = tryParseJson(line.trim());
  if (obj === undefined) {
    return undefined;
  }
  const parsed = StreamEventProbe.safeParse(obj);
  if (!parsed.success) {
    return undefined;
  }
  const e = parsed.data;
  const summary: ClaudeStreamEventSummary = { type: e.type };
  if (e.subtype !== undefined) {
    summary.subtype = e.subtype;
  }
  if (e.is_error !== undefined) {
    summary.isError = e.is_error;
  }
  if (e.num_turns !== undefined) {
    summary.numTurns = e.num_turns;
  }
  if (e.duration_ms !== undefined) {
    summary.durationMs = e.duration_ms;
  }
  const content = e.message?.content;
  if (content !== undefined) {
    const toolNames = content.flatMap((c) =>
      c.type === "tool_use" && c.name !== undefined ? [c.name] : [],
    );
    if (toolNames.length > 0) {
      summary.toolNames = toolNames;
    }
    const textChars = content.reduce(
      (n, c) => n + (c.type === "text" ? (c.text?.length ?? 0) : 0),
      0,
    );
    if (textChars > 0) {
      summary.textChars = textChars;
    }
  }
  return summary;
}
