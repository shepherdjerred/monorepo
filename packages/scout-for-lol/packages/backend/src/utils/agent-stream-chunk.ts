import { z } from "zod";

/**
 * Parse Mastra agent stream chunks into a small neutral shape.
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
  z.looseObject({ type: z.literal("step-start") }),
  z.looseObject({
    type: z.literal("text-delta"),
    payload: z.looseObject({ text: z.string() }),
  }),
  z.looseObject({
    type: z.literal("tool-call"),
    payload: z.looseObject({ toolName: z.string() }),
  }),
  z.looseObject({
    type: z.literal("tool-result"),
    payload: z.looseObject({
      toolName: z.string(),
      isError: z.boolean().optional(),
    }),
  }),
  z.looseObject({
    type: z.literal("tool-error"),
    payload: z.looseObject({
      toolName: z.string(),
      error: z.unknown(),
    }),
  }),
  z.looseObject({
    type: z.literal("error"),
    payload: z.looseObject({ error: z.unknown() }),
  }),
]);

export type AgentStreamChunk =
  | { kind: "step-start" }
  | { kind: "text-delta"; text: string }
  | { kind: "tool-call"; toolName: string }
  | { kind: "tool-result"; toolName: string; ok: boolean }
  | { kind: "tool-error"; toolName: string; message: string };

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
    case "step-start": {
      return { kind: "step-start" };
    }
    case "text-delta": {
      return chunk.payload.text.length > 0
        ? { kind: "text-delta", text: chunk.payload.text }
        : null;
    }
    case "tool-call": {
      return { kind: "tool-call", toolName: chunk.payload.toolName };
    }
    case "tool-result": {
      return {
        kind: "tool-result",
        toolName: chunk.payload.toolName,
        ok: chunk.payload.isError !== true,
      };
    }
    case "tool-error": {
      return {
        kind: "tool-error",
        toolName: chunk.payload.toolName,
        message: agentStreamErrorMessage(chunk.payload.error),
      };
    }
    case "error": {
      throw new Error(agentStreamErrorMessage(chunk.payload.error));
    }
  }
}

export function agentStreamErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
