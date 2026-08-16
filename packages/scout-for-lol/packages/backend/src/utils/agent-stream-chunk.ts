import { z } from "zod";

/**
 * Parse AI SDK agent stream chunks into a small neutral shape.
 *
 * The wire shape belongs to the model provider, so it is validated in one
 * place and every agent maps the result onto its own stream events. Chunks
 * that do not parse are dropped rather than thrown: a new chunk kind
 * appearing upstream should not fail a turn that is otherwise producing a
 * good answer. A chunk that carries a real error is the exception — the
 * caller gets it as a thrown error, because a turn that errored has no
 * answer to salvage.
 */

const AgentStreamChunkSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("start-step") }),
  z.looseObject({
    type: z.literal("text-delta"),
    text: z.string(),
  }),
  z.looseObject({
    type: z.literal("tool-call"),
    toolName: z.string(),
  }),
  // The AI SDK reports a failed tool as its own `tool-error` part rather than
  // as a `tool-result` carrying a flag, so a `tool-result` that arrives at all
  // succeeded.
  z.looseObject({
    type: z.literal("tool-result"),
    toolName: z.string(),
  }),
  z.looseObject({
    type: z.literal("tool-error"),
    toolName: z.string(),
    error: z.unknown(),
  }),
  z.looseObject({
    type: z.literal("error"),
    error: z.unknown(),
  }),
]);

export type AgentStreamChunk =
  | { kind: "step-start" }
  | { kind: "text-delta"; text: string }
  | { kind: "tool-call"; toolName: string }
  | { kind: "tool-result"; toolName: string; ok: boolean }
  | { kind: "tool-error"; toolName: string; message: string };

/**
 * Note on structured output: there is deliberately no `object` member here.
 *
 * The AI SDK delivers progressively-parsed structured output on a *separate*
 * `partialOutputStream`, never as a part on the wire stream — so a snapshot is
 * not a wire chunk and cannot be parsed out of one. Consumers that want
 * readable prose read that second stream directly; `text-delta` on this stream
 * carries the raw JSON being assembled, not prose.
 */

/**
 * Returns null for chunks that carry nothing an agent needs to act on.
 * Throws when the chunk reports a stream error.
 */
export function parseAgentStreamChunk(
  rawChunk: unknown,
): AgentStreamChunk | null {
  const parsed = AgentStreamChunkSchema.safeParse(rawChunk);
  if (!parsed.success) {
    return null;
  }
  const chunk = parsed.data;
  switch (chunk.type) {
    case "start-step": {
      return { kind: "step-start" };
    }
    case "text-delta": {
      return chunk.text.length > 0
        ? { kind: "text-delta", text: chunk.text }
        : null;
    }
    case "tool-call": {
      return { kind: "tool-call", toolName: chunk.toolName };
    }
    case "tool-result": {
      return {
        kind: "tool-result",
        toolName: chunk.toolName,
        ok: true,
      };
    }
    case "tool-error": {
      return {
        kind: "tool-error",
        toolName: chunk.toolName,
        message: agentStreamErrorMessage(chunk.error),
      };
    }
    case "error": {
      throw new Error(agentStreamErrorMessage(chunk.error));
    }
  }
}

export function agentStreamErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
