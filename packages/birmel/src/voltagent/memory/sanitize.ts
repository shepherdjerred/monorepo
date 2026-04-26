import type { UIMessage } from "ai";
import { z } from "zod";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

/**
 * Strip reasoning parts that lack `encryptedContent`.
 *
 * Background: before we set `store: false` + `include:["reasoning.encrypted_content"]`,
 * VoltAgent persisted assistant messages whose reasoning parts referenced
 * OpenAI-side stored items by `itemId` only (no inline content). When those
 * messages are replayed in a later turn, the provider emits
 * `{ type: "item_reference", id: "rs_..." }` and OpenAI rejects the request
 * because the referenced item no longer exists.
 *
 * This sanitizer drops those orphan reasoning parts at load time so legacy
 * memory rows don't keep crashing the bot. New messages produced after the
 * provider-options change include `encryptedContent` and pass through
 * unchanged.
 *
 * Reasoning parts with `encryptedContent` are kept as-is — the provider can
 * replay them inline.
 */

const ReasoningPartSchema = z.looseObject({
  type: z.literal("reasoning"),
  providerMetadata: z
    .looseObject({
      openai: z
        .looseObject({
          reasoningEncryptedContent: z.string().optional().nullable(),
        })
        .optional(),
    })
    .optional(),
});

function partIsReplayableReasoningPart(part: unknown): boolean {
  const parsed = ReasoningPartSchema.safeParse(part);
  if (!parsed.success) {
    return false;
  }
  const encrypted =
    parsed.data.providerMetadata?.openai?.reasoningEncryptedContent;
  return typeof encrypted === "string" && encrypted.length > 0;
}

function partIsLegacyReasoningPart(part: unknown): boolean {
  const parsed = ReasoningPartSchema.safeParse(part);
  if (!parsed.success) {
    // Not a reasoning part at all — keep.
    return false;
  }
  // It IS a reasoning part — only legacy if it lacks encryptedContent.
  return !partIsReplayableReasoningPart(part);
}

export function sanitizeMessageForReplay<M extends UIMessage>(message: M): M {
  if (!Array.isArray(message.parts)) {
    return message;
  }

  let droppedCount = 0;
  const sanitizedParts: typeof message.parts = [];
  for (const part of message.parts) {
    if (partIsLegacyReasoningPart(part)) {
      droppedCount += 1;
      continue;
    }
    sanitizedParts.push(part);
  }

  if (droppedCount === 0) {
    return message;
  }

  logger.debug("Dropped legacy reasoning parts on memory load", {
    module: "voltagent.memory.sanitize",
    messageId: message.id,
    droppedCount,
  });

  return { ...message, parts: sanitizedParts };
}

export function sanitizeMessagesForReplay<M extends UIMessage>(
  messages: M[],
): M[] {
  return messages.map((message) => sanitizeMessageForReplay(message));
}
